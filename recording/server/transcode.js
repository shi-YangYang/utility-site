'use strict';

/**
 * ffmpeg / ffprobe 封装。
 *
 * 本项目唯一的重外部依赖。服务启动时必须先探测，不可用就直接退出，
 * 不允许等到有人提交录音时才在转码环节报错。
 *
 * 转码原则（见 .ai/decisions/004-audio-pipeline.md）：
 * 只做「声道合并 + 重采样 + 编码转 PCM」，**不加任何滤波器**。
 * 浏览器默认开启的回声消除 / 噪声抑制 / 自动增益已经在采集端关掉了，
 * 这里更不能引入任何额外处理。
 */

const { execFile } = require('child_process');

/** 单次 ffmpeg / ffprobe 调用的默认超时。转码几十秒的音频远用不到这么久。 */
const DEFAULT_TIMEOUT_MS = 120 * 1000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** ffmpeg 不可用（未安装 / 路径不对 / 不可执行）时抛出的错误类型。 */
class FfmpegUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'FfmpegUnavailableError';
    this.cause = cause;
  }
}

/** 转码失败时抛出的错误类型。 */
class TranscodeError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'TranscodeError';
    this.detail = detail;
  }
}

function runCommand(command, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          // ENOENT：命令不存在；EACCES：存在但不可执行
          err.commandMissing = err.code === 'ENOENT' || err.code === 'EACCES';
          reject(Object.assign(err, { stdout, stderr }));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

/**
 * 探测 ffmpeg 是否可用，返回版本首行。
 * 失败时抛出 FfmpegUnavailableError，附带中文安装提示。
 */
async function detectFfmpeg(ffmpegPath) {
  let result;
  try {
    result = await runCommand(ffmpegPath, ['-version'], { timeoutMs: 20 * 1000 });
  } catch (err) {
    const reason = err.commandMissing
      ? `找不到可执行文件：${ffmpegPath}`
      : `执行失败：${err.message}`;
    throw new FfmpegUnavailableError(
      [
        `检测 ffmpeg 失败 —— ${reason}`,
        '',
        '本项目需要 ffmpeg 把浏览器录出的音频统一转成 WAV，缺少它无法工作。',
        '安装方式：',
        '  macOS          : brew install ffmpeg',
        '  Debian / Ubuntu: sudo apt-get update && sudo apt-get install -y ffmpeg',
        '  Windows        : 下载 https://www.gyan.dev/ffmpeg/builds/ 并加入 PATH',
        '安装完成后执行 ffmpeg -version 确认；若 ffmpeg 不在 PATH 里，',
        '用环境变量 FFMPEG_PATH 指定可执行文件的完整路径。',
      ].join('\n'),
      err
    );
  }

  const firstLine = String(result.stdout || result.stderr || '').split('\n')[0].trim();
  if (!/ffmpeg version/i.test(firstLine)) {
    throw new FfmpegUnavailableError(
      [
        `检测 ffmpeg 失败 —— ${ffmpegPath} 的输出无法识别为 ffmpeg。`,
        `实际输出：${firstLine || '(空)'}`,
        '',
        '请确认 FFMPEG_PATH 指向的是 ffmpeg 本体，而不是别的同名程序。',
      ].join('\n')
    );
  }
  return firstLine;
}

/**
 * 把任意输入音频转成规整 WAV：单声道、`pcm_s16le`、采样率 sampleRate。
 * 不使用任何 -af / -filter 参数。
 */
async function transcodeToWav({ inputPath, outputPath, sampleRate, ffmpegPath, timeoutMs }) {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i', inputPath,
    // 丢掉非音频流（某些容器里带视频轨 / 字幕轨）
    '-vn', '-sn', '-dn',
    // 单声道 + 目标采样率 + 16-bit PCM，无任何滤波器
    '-ac', '1',
    '-ar', String(sampleRate),
    '-c:a', 'pcm_s16le',
    '-f', 'wav',
    outputPath,
  ];

  try {
    await runCommand(ffmpegPath, args, { timeoutMs });
  } catch (err) {
    const detail = String(err.stderr || err.message || '').trim().split('\n').slice(-6).join('\n');
    throw new TranscodeError(`ffmpeg 转码失败：${detail}`, detail);
  }
  return outputPath;
}

/**
 * 用 ffprobe 读取产物信息，用于复核时长与格式。
 * 返回值中的 durationSec 是判断「录音是否过短」的唯一依据。
 */
async function probeAudio({ filePath, ffprobePath, timeoutMs }) {
  const args = [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,channels,duration,bit_rate',
    '-show_entries', 'format=duration,size,format_name',
    '-of', 'json',
    filePath,
  ];

  let result;
  try {
    result = await runCommand(ffprobePath, args, { timeoutMs });
  } catch (err) {
    const detail = String(err.stderr || err.message || '').trim().split('\n').slice(-4).join('\n');
    throw new TranscodeError(`ffprobe 读取音频信息失败：${detail}`, detail);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch (err) {
    throw new TranscodeError(`ffprobe 输出无法解析：${err.message}`);
  }

  const stream = (parsed.streams && parsed.streams[0]) || {};
  const format = parsed.format || {};

  const durationSec = Number(
    Number.isFinite(Number(stream.duration)) ? stream.duration : format.duration
  );
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new TranscodeError('ffprobe 未能读出有效时长，转码产物不可信');
  }

  return {
    durationSec,
    codecName: stream.codec_name || '',
    sampleRate: Number(stream.sample_rate) || 0,
    channels: Number(stream.channels) || 0,
    formatName: format.format_name || '',
    sizeBytes: Number(format.size) || 0,
  };
}

module.exports = {
  FfmpegUnavailableError,
  TranscodeError,
  detectFfmpeg,
  transcodeToWav,
  probeAudio,
};
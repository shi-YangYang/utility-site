'use strict';

/**
 * 配置读取：环境变量 + 内置默认值。
 *
 * 所有可调项都走环境变量，代码里只保留一份默认值，方便 Docker 部署时用 -e 覆盖。
 * 朗读稿（时长阈值、文稿正文）是数据不是配置，从 content/passages.json 读取。
 */

const fs = require('fs');
const path = require('path');

/** 项目根目录（recording/），所有相对路径都以它为基准，保证从任何位置启动结果一致。 */
const ROOT_DIR = path.resolve(__dirname, '..');

/** 上线前必须改掉的默认管理端口令 —— 启动时会据此打印警告。 */
const DEFAULT_ADMIN_CODE = 'admin123';
/** 员工端默认口令。 */
const DEFAULT_EMPLOYEE_CODE = '123';

const PASSAGES_FILE = path.join(ROOT_DIR, 'content', 'passages.json');

/**
 * 尝试读取项目根目录下的 .env。
 * 用 Node 内置的 process.loadEnvFile（Node 20.12+），不引入 dotenv 之类的依赖。
 * 已存在于 process.env 的变量不会被覆盖，因此命令行传入的 -e / export 优先级更高。
 * Node 版本过低时直接跳过，只使用真实环境变量。
 */
function loadDotEnvIfPresent() {
  if (typeof process.loadEnvFile !== 'function') return;
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn(`[配置] 读取 .env 失败，将只使用环境变量与内置默认值：${err.message}`);
  }
}

loadDotEnvIfPresent();

function readString(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  return String(raw);
}

function readInt(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`环境变量 ${name} 的值不合法：${raw}（应为 ${min} 到 ${max} 之间的整数）`);
  }
  return value;
}

/** DATA_DIR 允许相对路径，相对的是项目根目录而不是当前工作目录。 */
function resolveDataDir(raw) {
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(ROOT_DIR, raw);
}

/**
 * 推导 ffprobe 的路径。
 * 只配置了 FFMPEG_PATH，ffprobe 正常情况下与 ffmpeg 装在同一目录。
 * 若 FFMPEG_PATH 是标准命名（ffmpeg / ffmpeg.exe），取同目录下的 ffprobe；
 * 否则退回到 PATH 里的 ffprobe。
 */
function deriveFfprobePath(ffmpegPath) {
  const base = path.basename(ffmpegPath);
  if (base === 'ffmpeg' || base === 'ffmpeg.exe') {
    const probeName = base === 'ffmpeg.exe' ? 'ffprobe.exe' : 'ffprobe';
    const dir = path.dirname(ffmpegPath);
    return dir === '.' ? probeName : path.join(dir, probeName);
  }
  return 'ffprobe';
}

/**
 * 读取并校验朗读稿。文稿是纯数据，服务端只做结构性校验，不改写内容。
 * 配置有问题时在启动阶段就抛错，不要等到有人提交录音才发现。
 */
function loadPassages() {
  let raw;
  try {
    raw = fs.readFileSync(PASSAGES_FILE, 'utf8');
  } catch (err) {
    throw new Error(`无法读取朗读稿文件 ${PASSAGES_FILE}：${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`朗读稿文件不是合法 JSON：${PASSAGES_FILE}（${err.message}）`);
  }

  const segments = Array.isArray(data.segments) ? data.segments : [];
  if (segments.length === 0) {
    throw new Error(`朗读稿文件缺少 segments 数组或为空：${PASSAGES_FILE}`);
  }
  for (const seg of segments) {
    if (!seg || typeof seg.key !== 'string' || !seg.key) {
      throw new Error(`朗读稿 segments 中有一项缺少合法的 key：${PASSAGES_FILE}`);
    }
    if (typeof seg.text !== 'string' || seg.text.trim() === '') {
      throw new Error(`朗读稿段落 ${seg.key} 的 text 为空：${PASSAGES_FILE}`);
    }
  }

  const keys = new Set(segments.map((s) => s.key));
  if (keys.size !== segments.length) {
    throw new Error(`朗读稿 segments 中的 key 有重复：${PASSAGES_FILE}`);
  }

  return {
    file: PASSAGES_FILE,
    targetSeconds: Number.isFinite(Number(data.targetSeconds)) ? Number(data.targetSeconds) : 60,
    minSeconds: Number.isFinite(Number(data.minSeconds)) ? Number(data.minSeconds) : 10,
    maxSeconds: Number.isFinite(Number(data.maxSeconds)) ? Number(data.maxSeconds) : 180,
    segments: segments.map((seg) => ({
      key: seg.key,
      label: typeof seg.label === 'string' ? seg.label : seg.key,
      lang: typeof seg.lang === 'string' ? seg.lang : '',
      text: seg.text,
    })),
  };
}

function buildConfig() {
  const dataDir = resolveDataDir(readString('DATA_DIR', './data'));
  const ffmpegPath = readString('FFMPEG_PATH', 'ffmpeg');
  const maxUploadMb = readInt('MAX_UPLOAD_MB', 50, { min: 1, max: 4096 });

  return {
    rootDir: ROOT_DIR,
    publicDir: path.join(ROOT_DIR, 'public'),
    contentDir: path.join(ROOT_DIR, 'content'),

    port: readInt('PORT', 3000, { min: 1, max: 65535 }),
    employeeCode: readString('EMPLOYEE_CODE', DEFAULT_EMPLOYEE_CODE),
    adminCode: readString('ADMIN_CODE', DEFAULT_ADMIN_CODE),

    /** 运行时数据根目录，录音、索引、临时文件都在它下面。 */
    dataDir,
    recordingsDir: path.join(dataDir, 'recordings'),
    indexPath: path.join(dataDir, 'index.json'),
    tmpDir: path.join(dataDir, 'tmp'),

    sampleRate: readInt('SAMPLE_RATE', 16000, { min: 8000, max: 192000 }),
    maxUploadMb,
    maxUploadBytes: maxUploadMb * 1024 * 1024,

    ffmpegPath,
    ffprobePath: deriveFfprobePath(ffmpegPath),

    defaultAdminCode: DEFAULT_ADMIN_CODE,
    defaultEmployeeCode: DEFAULT_EMPLOYEE_CODE,

    /** 索引结构版本号，便于将来演进。 */
    indexVersion: 1,
  };
}

module.exports = {
  ROOT_DIR,
  PASSAGES_FILE,
  DEFAULT_ADMIN_CODE,
  DEFAULT_EMPLOYEE_CODE,
  loadPassages,
  config: buildConfig(),
};
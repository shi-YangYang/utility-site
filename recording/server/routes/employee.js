'use strict';

/**
 * F2 员工端口令校验 + F4 提交录音。
 *
 * 安全边界在 F4：`/api/employee/access` 只是给前端放行界面用的，
 * 真正把关的是提交接口 —— 它会再校验一次口令，绕过前端直接打接口没有任何特权。
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { finished } = require('stream/promises');
const busboy = require('busboy');

const { sendJson, readJsonBody, verifyCode, randomToken, HttpError } = require('../http-util');
const { transcodeToWav, probeAudio, TranscodeError } = require('../transcode');
const { MAX_RAW_NAME_LENGTH } = require('../sanitize');
const { SEGMENT_KEYS } = require('../store');

/** 单次提交允许的字段数与单个字段长度上限，防止畸形表单撑爆内存。 */
const FIELD_LIMITS = { fields: 8, fieldSize: 16 * 1024, parts: 12 };

/**
 * 单个文件在内存里暂存的字节上限。
 *
 * 口令字段在表单里的位置不确定（可能排在音频之后），所以文件刚到时还不能判断
 * 这次提交是否合法。为了做到「口令错误时不产生任何文件」，
 * 小文件先留在内存里，等口令判定之后再决定落盘还是丢弃；
 * 超过这个上限（真实录音的正常大小）才边收边写临时文件。
 */
const MEMORY_BUFFER_LIMIT_BYTES = 8 * 1024 * 1024;

/**
 * 上传中断 / 超时的兜底时限（毫秒）。
 *
 * 客户端中途断线时，busboy 不保证 emit `'close'` —— 请求处理流程会永远停在
 * `await parserFinished` 上，已经创建的写流和 `tmp/` 下的半截文件就再也没人管。
 * `spec.md`「边界条件」要求「请求中断**或超时**都不得留下半截文件」，所以这里自己盯一层：
 *
 * - 空闲超时：连续这么久一个字节都没收到，按"对端已经死了"处理；
 * - 总时长超时：整个请求体接收阶段的硬上限，覆盖"一直在慢速传、但永远传不完"。
 *
 * 量级说明：正常录音只有几百 KB 到几 MB，办公网内远用不到这个时限，正常提交不受影响。
 */
const UPLOAD_IDLE_TIMEOUT_MS = 30 * 1000;
const UPLOAD_TOTAL_TIMEOUT_MS = 60 * 1000;

/** 落盘前的自我复核：产物必须真的是单声道 16-bit PCM 的目标采样率 WAV。 */
function assertWavAsExpected(info, expectedSampleRate, segmentLabel) {
  if (info.codecName !== 'pcm_s16le') {
    throw new TranscodeError(`${segmentLabel}转码结果的编码不是 pcm_s16le（实际 ${info.codecName}）`);
  }
  if (info.channels !== 1) {
    throw new TranscodeError(`${segmentLabel}转码结果不是单声道（实际 ${info.channels} 声道）`);
  }
  if (info.sampleRate !== expectedSampleRate) {
    throw new TranscodeError(
      `${segmentLabel}转码结果的采样率不是 ${expectedSampleRate} Hz（实际 ${info.sampleRate} Hz）`
    );
  }
}

function createEmployeeRoutes(ctx) {
  const { config, passages, store, log } = ctx;
  const segmentLabels = {};
  for (const segment of passages.segments) segmentLabels[segment.key] = segment.label;

  /** 删除一组临时文件，失败只记日志 —— 清理不该把已经成功的结果变成失败。 */
  async function removeQuietly(paths) {
    await Promise.all(
      paths.map((p) =>
        fsp.rm(p, { force: true }).catch((err) => {
          // 正常文件系统上不该发生；发生了说明 DATA_DIR 不允许删除文件
          log.warn(`清理临时文件失败（已忽略）：${p} —— ${err.code || err.message}`);
        })
      )
    );
  }

  /**
   * F4：接收 multipart 表单，转码、校验、落盘、更新索引。
   *
   * 顺序固定：收到临时文件 → 转码成 WAV → ffprobe 复核 → 全部通过后才写索引。
   * 任一环节失败都要把已经产生的文件清干净，绝不留下半截文件或索引记录。
   */
  async function postSubmit(req, res) {
    const contentType = String(req.headers['content-type'] || '');
    if (!/^multipart\/form-data/i.test(contentType)) {
      sendJson(res, 400, { ok: false, error: '提交必须是 multipart/form-data 表单' });
      return;
    }

    let bb;
    try {
      bb = busboy({
        headers: req.headers,
        limits: { ...FIELD_LIMITS, fileSize: config.maxUploadBytes, files: SEGMENT_KEYS.length },
      });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: `表单解析失败：${err.message}` });
      return;
    }

    /** 上传的音频：段名 -> 见 newUploadEntry() 的结构 */
    const uploads = new Map();
    const fields = {};
    const pendingWrites = [];
    let authState = 'unknown'; // unknown | good | bad
    let responded = false;
    let parseError = null;
    let tooManyFiles = false;
    let tooManyFields = false;

    const respondOnce = (statusCode, payload) => {
      if (responded) return;
      responded = true;
      // 客户端已经断开就没人收这个响应了，直接丢弃，不往已经销毁的 socket 上写
      if (res.destroyed || res.writableEnded) return;
      sendJson(res, statusCode, payload);
    };

    /**
     * 销毁本次上传已经创建的所有写流，并等它们的 fd 真正关闭。
     * 必须先关流再删文件：反过来的话 fd 会一直挂在一个已经被 unlink 的 inode 上，
     * 文件描述符照样泄漏（在挂载成 FUSE 的目录上还会以 .fuse_hidden* 的形式留在盘上）。
     */
    const destroyWriteStreams = () => {
      const waits = [];
      for (const entry of uploads.values()) {
        const stream = entry.writeStream;
        if (!stream || stream.destroyed) continue;
        waits.push(finished(stream).catch(() => {}));
        stream.destroy();
      }
      return Promise.all(waits);
    };

    /** 丢弃所有上传：内存里的直接丢，已落盘的尽量删。 */
    const cleanupUploads = async () => {
      const paths = [];
      for (const entry of uploads.values()) {
        if (entry.path) paths.push(entry.path);
        entry.memory = [];
        entry.memoryBytes = 0;
      }
      await destroyWriteStreams();
      uploads.clear();
      await removeQuietly(paths);
    };

    // ---------------------------------------------------------------- 中断 / 超时兜底

    let aborted = false;
    let abortKind = null; // 'client-abort' | 'idle-timeout' | 'total-timeout'
    let resolveAbort = null;
    /** 一旦中断或超时就会 resolve，用来叫醒下面所有 await，避免流程永远悬挂。 */
    const abortSignal = new Promise((resolve) => {
      resolveAbort = resolve;
    });
    let idleTimer = null;
    let totalTimer = null;

    const clearTimers = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (totalTimer) {
        clearTimeout(totalTimer);
        totalTimer = null;
      }
    };

    /**
     * 判定这次上传已经死了：停掉解析器、立刻释放写流，并让等待解析结果的流程醒过来。
     * 只做"止损"，真正的收尾（删文件、回响应）在 finishAbortedUpload 里做。
     */
    const abortUpload = (kind) => {
      if (aborted) return;
      aborted = true;
      abortKind = kind;
      clearTimers();
      // 请求已经断了，这些调用失败无所谓，但一定要做：busboy 会连带 destroy 掉
      // 当前的文件流，把它的内部状态彻底放掉
      try {
        req.unpipe(bb);
      } catch {
        /* 连接已断开，忽略 */
      }
      try {
        bb.destroy();
      } catch {
        /* 同上 */
      }
      if (resolveAbort) resolveAbort(kind);
      // 不等收尾阶段，fd 越早还回去越好
      void destroyWriteStreams();
    };

    /**
     * 中断 / 超时的收尾：销毁写流、删掉这次上传产生的半截文件。
     * 客户端已经走了就不回响应；因为超时断开时对端可能还连着，回一个 408 说清楚原因。
     */
    const finishAbortedUpload = async () => {
      clearTimers();
      await cleanupUploads();
      if (abortKind !== 'client-abort') {
        respondOnce(408, { ok: false, error: '上传超时，已终止这次提交，请重新提交' });
      }
      log.info(`上传未完成（${abortKind}），临时文件已清理`);
    };

    /** 有数据到达就重置空闲计时；正常上传会持续有数据，不会误伤。 */
    const noteProgress = () => {
      if (aborted) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abortUpload('idle-timeout'), UPLOAD_IDLE_TIMEOUT_MS);
      idleTimer.unref();
    };

    req.on('data', noteProgress);
    idleTimer = setTimeout(() => abortUpload('idle-timeout'), UPLOAD_IDLE_TIMEOUT_MS);
    idleTimer.unref();
    totalTimer = setTimeout(() => abortUpload('total-timeout'), UPLOAD_TOTAL_TIMEOUT_MS);
    totalTimer.unref();

    // 客户端断线：req 的 'aborted' / 'close' / 'error' 与 res 的 'close' 都盯着。
    // 判据是 `req.complete` —— 请求体正常收完时 'close' 同样会触发，那不是中断，
    // 不能拿它当断线处理（否则会把正在转码/落盘的好数据误判掉）。
    const onClientGone = () => {
      if (!req.complete) abortUpload('client-abort');
    };
    req.on('aborted', onClientGone);
    req.on('close', onClientGone);
    req.on('error', onClientGone);
    res.on('close', () => {
      if (!req.complete && !res.writableFinished) abortUpload('client-abort');
    });

    /** 把还留在内存里的上传写到临时文件（只在口令通过后调用）。 */
    const materializeUploads = async () => {
      for (const entry of uploads.values()) {
        if (!entry.buffered) continue;
        const tmpPath = path.join(config.tmpDir, `upload-${randomToken(8)}.bin`);
        await fsp.writeFile(tmpPath, Buffer.concat(entry.memory));
        entry.path = tmpPath;
        entry.buffered = false;
        entry.memory = [];
        entry.memoryBytes = 0;
      }
    };

    bb.on('field', (fieldName, value) => {
      if (fieldName === 'code') {
        fields.code = value;
        authState = verifyCode(config.employeeCode, value) ? 'good' : 'bad';
        if (authState === 'bad') {
          // 口令不对就立即拒绝：后面来的文件一律丢弃，已经收下的在收尾时清掉
          respondOnce(401, { ok: false, error: '口令不正确' });
        }
        return;
      }
      if (fieldName === 'name') {
        fields.name = value;
      }
    });

    bb.on('file', (fieldName, fileStream, info) => {
      // busboy 在解析器被销毁（包括我们主动 destroy）时，会带着错误 destroy 掉当前
      // 文件流；没有 error 监听的话这就是个未处理事件，会把整个进程带崩。
      // 中断、畸形表单都会走到这里，所以每个文件流都得兜住。
      fileStream.on('error', () => {});

      // 已经拒绝、字段不认识、口令已判定错误、或者同一段重复上传 —— 一律丢弃不落盘
      if (responded || authState === 'bad' || !SEGMENT_KEYS.includes(fieldName) || uploads.has(fieldName)) {
        fileStream.resume();
        return;
      }

      const entry = {
        field: fieldName,
        path: null,
        bytes: 0,
        truncated: false,
        error: null,
        mimeType: info && info.mimeType,
        buffered: true,
        memory: [],
        memoryBytes: 0,
        writeStream: null,
      };
      uploads.set(fieldName, entry);

      fileStream.on('limit', () => {
        entry.truncated = true;
      });

      /** 改为边收边写临时文件。firstChunk 是触发落盘的那一块，避免丢数据。 */
      const startSpilling = (firstChunk) => {
        const writeStream = fs.createWriteStream(path.join(config.tmpDir, `upload-${randomToken(8)}.bin`));
        entry.path = writeStream.path;
        entry.buffered = false;
        entry.writeStream = writeStream;

        fileStream.pause();
        fileStream.off('data', onData);
        for (const buffered of entry.memory) writeStream.write(buffered);
        entry.memory = [];
        entry.memoryBytes = 0;
        if (firstChunk) writeStream.write(firstChunk);
        fileStream.pipe(writeStream);
      };

      const onData = (chunk) => {
        if (entry.memoryBytes + chunk.length <= MEMORY_BUFFER_LIMIT_BYTES) {
          entry.memory.push(chunk);
          entry.memoryBytes += chunk.length;
          return;
        }
        startSpilling(chunk);
      };

      // 口令已经确认过，就没必要在内存里过一道，直接落盘
      if (authState === 'good') {
        startSpilling(null);
      } else {
        fileStream.on('data', onData);
      }

      pendingWrites.push(
        (async () => {
          try {
            await finished(fileStream);
            if (entry.writeStream) await finished(entry.writeStream);
          } catch (err) {
            entry.error = err;
          }
          entry.bytes = entry.buffered
            ? entry.memoryBytes
            : Number(entry.writeStream && entry.writeStream.bytesWritten) || 0;
        })()
      );
    });

    bb.on('filesLimit', () => {
      tooManyFiles = true;
    });
    bb.on('fieldsLimit', () => {
      tooManyFields = true;
    });
    bb.on('error', (err) => {
      parseError = err;
    });

    const parserFinished = new Promise((resolve) => {
      bb.on('close', resolve);
      bb.on('error', resolve);
    });

    try {
      req.pipe(bb);
    } catch (err) {
      parseError = err;
    }

    // 请求体的接收阶段有三个出口：解析完成 / 客户端断线 / 超时。
    // 后两个由 abortSignal 通知 —— 断线时 busboy 不保证 emit 'close'，
    // 只 await parserFinished 会永远等下去（这正是之前 fd 与半截文件泄漏的根源）。
    await Promise.race([parserFinished, abortSignal]);
    if (aborted) {
      await finishAbortedUpload();
      return;
    }

    // 请求体已经收完，接收阶段结束，时限不再适用：后面的转码与落盘只跟本地文件打交道，
    // 不能被上传时限打断（否则可能停在写盘中途）。
    clearTimers();

    // 写流刷盘也可能因为断线而永远不会 settle，同样要有中断出口
    await Promise.race([Promise.all(pendingWrites), abortSignal]);
    if (aborted) {
      await finishAbortedUpload();
      return;
    }

    if (responded) {
      // 已经在口令环节拒绝过，这里只负责收尾清理
      await cleanupUploads();
      return;
    }

    if (parseError) {
      await cleanupUploads();
      respondOnce(400, { ok: false, error: `表单解析失败：${parseError.message}` });
      return;
    }

    if (authState !== 'good') {
      await cleanupUploads();
      respondOnce(401, { ok: false, error: '口令不正确' });
      return;
    }

    if (tooManyFields) {
      await cleanupUploads();
      respondOnce(400, { ok: false, error: '表单字段过多' });
      return;
    }

    const oversize = [...uploads.values()].find((entry) => entry.truncated);
    if (oversize) {
      await cleanupUploads();
      respondOnce(413, {
        ok: false,
        error: `单个音频文件不能超过 ${config.maxUploadMb} MB`,
      });
      return;
    }

    if (tooManyFiles) {
      await cleanupUploads();
      respondOnce(400, { ok: false, error: '一次只能提交两个音频文件' });
      return;
    }

    // ---- 姓名校验（按 Spec 只做非空与长度，不校验真实性） ----
    const name = typeof fields.name === 'string' ? fields.name.trim() : '';
    if (!name) {
      await cleanupUploads();
      respondOnce(400, { ok: false, error: '请填写姓名' });
      return;
    }
    if (Array.from(name).length > MAX_RAW_NAME_LENGTH) {
      await cleanupUploads();
      respondOnce(400, { ok: false, error: `姓名过长（最多 ${MAX_RAW_NAME_LENGTH} 个字符）` });
      return;
    }

    // ---- 两段音频必须同时提交 ----
    for (const key of SEGMENT_KEYS) {
      if (!uploads.has(key)) {
        await cleanupUploads();
        respondOnce(400, {
          ok: false,
          error: `缺少${segmentLabels[key] || key}录音，两段录音必须一起提交`,
        });
        return;
      }
    }
    for (const key of SEGMENT_KEYS) {
      const entry = uploads.get(key);
      if (entry.error || entry.bytes === 0) {
        await cleanupUploads();
        respondOnce(400, {
          ok: false,
          error: `${segmentLabels[key] || key}录音是空文件，请重新录制`,
        });
        return;
      }
    }

    // ---- 口令与参数都通过了，这时才把上传真正落成临时文件 ----
    try {
      await materializeUploads();
    } catch (err) {
      await cleanupUploads();
      log.error(`写入临时文件失败：${err.message}`);
      respondOnce(500, { ok: false, error: '服务端写入临时文件失败，请重试' });
      return;
    }

    // ---- 转码 + 复核 ----
    const convertedPaths = [];
    const transcoded = {};
    try {
      for (const key of SEGMENT_KEYS) {
        const outputPath = path.join(config.tmpDir, `wav-${randomToken(8)}.wav`);
        await transcodeToWav({
          inputPath: uploads.get(key).path,
          outputPath,
          sampleRate: config.sampleRate,
          ffmpegPath: config.ffmpegPath,
        });
        convertedPaths.push(outputPath);

        const info = await probeAudio({ filePath: outputPath, ffprobePath: config.ffprobePath });
        assertWavAsExpected(info, config.sampleRate, segmentLabels[key] || key);

        const stat = await fsp.stat(outputPath);
        if (!stat.isFile() || stat.size === 0) {
          throw new TranscodeError(`${segmentLabels[key] || key}转码产物为空`);
        }

        transcoded[key] = {
          tempPath: outputPath,
          durationSec: info.durationSec,
          bytes: stat.size,
          sampleRate: info.sampleRate,
          channels: info.channels,
        };
      }
    } catch (err) {
      await cleanupUploads();
      await removeQuietly(convertedPaths);
      log.error(`转码失败：${err.message}`);
      respondOnce(500, { ok: false, error: '音频转码失败，请重试；若持续失败请联系管理员' });
      return;
    }

    // ---- 时长下限：转码产物太短 → 400，并删掉已生成的文件 ----
    for (const key of SEGMENT_KEYS) {
      const duration = transcoded[key].durationSec;
      if (duration < passages.minSeconds) {
        await cleanupUploads();
        await removeQuietly(convertedPaths);
        respondOnce(400, {
          ok: false,
          error: `${segmentLabels[key] || key}录音太短（${duration.toFixed(1)} 秒），至少需要 ${passages.minSeconds} 秒`,
        });
        return;
      }
    }

    // ---- 落盘 + 更新索引（索引是最后一步） ----
    try {
      const { employee } = await store.upsertEmployee({ name, segments: transcoded });
      await cleanupUploads();
      respondOnce(200, { ok: true, name: employee.name, updatedAt: employee.updatedAt });
    } catch (err) {
      await cleanupUploads();
      await removeQuietly(convertedPaths);
      log.error(`保存录音失败：${err.message}`);
      respondOnce(500, { ok: false, error: '保存录音失败，请重试；若持续失败请联系管理员' });
    }
  }

  return {
    // POST /api/employee/access
    async postAccess(req, res) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        const status = err instanceof HttpError ? err.statusCode : 400;
        sendJson(res, status, { ok: false, error: err.message });
        return;
      }
      if (!verifyCode(config.employeeCode, body.code)) {
        sendJson(res, 401, { ok: false, error: '口令不正确' });
        return;
      }
      sendJson(res, 200, { ok: true });
    },

    postSubmit,
  };
}

module.exports = { createEmployeeRoutes };
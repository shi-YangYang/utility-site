'use strict';

/**
 * F5 管理端登录 / F6 提交列表 / F7 音频试听 / F8 音频下载。
 *
 * 会话：口令校验通过后下发一个随机 token，放在 `HttpOnly` + `SameSite=Strict`
 * 的 cookie 里；token 只存在服务端内存中，前端脚本读不到也伪造不了。
 * 这里的接口一律先鉴权，未登录直接 401。
 */

const fs = require('fs');
const fsp = require('fs/promises');

const {
  sendJson,
  sendError,
  readJsonBody,
  verifyCode,
  parseCookies,
  serializeCookie,
  randomToken,
  HttpError,
} = require('../http-util');
const { SEGMENT_KEYS } = require('../store');

const SESSION_COOKIE = 'rec_admin';
/** 会话有效期 12 小时 —— 管理员一个工作日不用反复登录。 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** 浏览器能直接播放的容器类型。 */
const AUDIO_CONTENT_TYPE = 'audio/wav';

/**
 * 解析 `Range` 请求头。
 * @returns {null | {invalid: boolean, start?: number, end?: number}}
 *   null 表示没有 Range（正常返回整个文件）；invalid 表示语法非法或越界（应回 416）。
 */
function parseRangeHeader(header, totalSize) {
  if (!header) return null;
  const match = /^bytes=(.+)$/i.exec(String(header).trim());
  if (!match) return { invalid: true };

  const spec = match[1].trim();
  // 多段 Range 本项目不支持，按非法处理（播放器不会用到）
  if (spec.includes(',')) return { invalid: true };

  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return { invalid: true };
  const [, rawStart, rawEnd] = parts;
  if (rawStart === '' && rawEnd === '') return { invalid: true };

  if (rawStart === '') {
    // 后缀形式 bytes=-N：最后 N 个字节
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    const start = Math.max(0, totalSize - suffixLength);
    return { invalid: false, start, end: totalSize - 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  if (!Number.isFinite(start) || start >= totalSize) return { invalid: true };

  if (rawEnd === '') return { invalid: false, start, end: totalSize - 1 };

  const end = Number.parseInt(rawEnd, 10);
  if (!Number.isFinite(end) || end < start) return { invalid: true };
  return { invalid: false, start, end: Math.min(end, totalSize - 1) };
}

/**
 * 生成下载文件名。
 * 中文名必须走 RFC 5987 的 `filename*`，同时给一个只含 ASCII 的 `filename` 兜底。
 */
function buildContentDisposition(name, segmentKey) {
  const fullName = `${name}-${segmentKey}.wav`;
  const asciiStripped = fullName
    .replace(/[/\\]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '_')
    .replace(/^[-_.\s]+/, '')
    .slice(0, 120);
  const asciiFallback = /[A-Za-z0-9]/.test(asciiStripped)
    ? asciiStripped
    : `recording-${segmentKey}.wav`;

  // encodeURIComponent 不会转义单引号，而它在 filename* 里是分隔符
  const encoded = encodeURIComponent(fullName).replace(/'/g, '%27');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function createAdminRoutes(ctx) {
  const { config, store, log } = ctx;

  /** token -> 过期时间戳。只放在内存里，进程重启即全部失效（可接受）。 */
  const sessions = new Map();

  function pruneSessions() {
    const now = Date.now();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) sessions.delete(token);
    }
  }

  function createSession() {
    pruneSessions();
    const token = randomToken(32);
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
  }

  function isAuthenticated(req) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (!token) return false;
    const expiresAt = sessions.get(token);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  }

  /** 除登录接口外，管理端接口统一先过这一关。 */
  function requireAdmin(req, res) {
    if (isAuthenticated(req)) return true;
    sendError(res, 401, '未登录或会话已过期');
    return false;
  }

  /** 把索引记录里的一段拼成 F6 要求的响应结构。 */
  function buildSegmentPayload(record, segmentKey) {
    const meta = record.segments && record.segments[segmentKey];
    if (!meta) return null;
    const id = encodeURIComponent(record.id);
    return {
      durationSec: Number(meta.durationSec) || 0,
      bytes: store.statSegmentFile(record, segmentKey) || Number(meta.bytes) || 0,
      audioUrl: `/api/admin/audio/${id}/${segmentKey}`,
      downloadUrl: `/api/admin/download/${id}/${segmentKey}`,
    };
  }

  /**
   * F7 / F8 共用的音频响应：支持 Range、支持 HEAD。
   * download 为 true 时额外带 Content-Disposition。
   */
  async function serveSegmentAudio(req, res, id, segmentKey, { download }) {
    if (!SEGMENT_KEYS.includes(segmentKey)) {
      sendError(res, 404, '录音段落不存在');
      return;
    }

    const record = store.findById(id);
    if (!record) {
      sendError(res, 404, '找不到该员工的记录');
      return;
    }

    let filePath;
    try {
      filePath = store.resolveSegmentFile(record, segmentKey);
    } catch (err) {
      log.error(`解析录音路径失败：${err.message}`);
      sendError(res, 404, '录音文件不存在');
      return;
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new Error('不是普通文件');
    } catch {
      sendError(res, 404, '录音文件不存在');
      return;
    }

    const totalSize = stat.size;
    const headers = {
      'Content-Type': AUDIO_CONTENT_TYPE,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    if (download) {
      headers['Content-Disposition'] = buildContentDisposition(record.name, segmentKey);
    }

    const range = parseRangeHeader(req.headers.range, totalSize);
    const isHead = req.method === 'HEAD';

    if (range && range.invalid) {
      res.writeHead(416, {
        ...headers,
        'Content-Range': `bytes */${totalSize}`,
      });
      res.end();
      return;
    }

    if (!range) {
      res.writeHead(200, { ...headers, 'Content-Length': totalSize });
      if (isHead) {
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }

    const { start, end } = range;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Content-Length': chunkSize,
    });
    if (isHead) {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  return {
    // POST /api/admin/login
    async login(req, res) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        const status = err instanceof HttpError ? err.statusCode : 400;
        sendError(res, status, err.message);
        return;
      }

      if (!verifyCode(config.adminCode, body.code)) {
        log.warn('管理端登录失败：口令不正确');
        sendError(res, 401, '口令不正确');
        return;
      }

      const token = createSession();
      sendJson(res, 200, { ok: true }, {
        'Set-Cookie': serializeCookie(SESSION_COOKIE, token, {
          maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
        }),
      });
      log.info('管理端登录成功');
    },

    // POST /api/admin/logout
    logout(req, res) {
      const cookies = parseCookies(req);
      const token = cookies[SESSION_COOKIE];
      if (token) sessions.delete(token);
      sendJson(res, 200, { ok: true }, {
        'Set-Cookie': serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0 }),
      });
    },

    // GET /api/admin/session —— 只回答「当前会话是否有效」，供页面决定显示登录框还是列表
    session(req, res) {
      sendJson(res, 200, { ok: true, authenticated: isAuthenticated(req) });
    },

    // GET /api/admin/submissions
    listSubmissions(req, res) {
      if (!requireAdmin(req, res)) return;

      const employees = store
        .listEmployees()
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map((record) => {
          const segments = {};
          for (const key of SEGMENT_KEYS) {
            const payload = buildSegmentPayload(record, key);
            if (payload) segments[key] = payload;
          }
          return {
            id: record.id,
            name: record.name,
            firstSubmittedAt: record.firstSubmittedAt,
            updatedAt: record.updatedAt,
            segments,
          };
        });

      sendJson(res, 200, { employees });
    },

    // GET /api/admin/audio/:id/:segment
    async getAudio(req, res, id, segmentKey) {
      if (!requireAdmin(req, res)) return;
      await serveSegmentAudio(req, res, id, segmentKey, { download: false });
    },

    // GET /api/admin/download/:id/:segment
    async downloadAudio(req, res, id, segmentKey) {
      if (!requireAdmin(req, res)) return;
      await serveSegmentAudio(req, res, id, segmentKey, { download: true });
    },
  };
}

module.exports = { createAdminRoutes, SESSION_COOKIE };
'use strict';

/**
 * HTTP 层的小工具：响应封装、请求体读取、cookie、口令比较。
 * 这里只放与业务无关的通用逻辑，接口语义在各个 routes/ 模块里。
 */

const crypto = require('crypto');

/** JSON 请求体（口令、登录）的大小上限，正常请求只有几十字节。 */
const MAX_JSON_BODY_BYTES = 16 * 1024;

/** 带状态码的错误，供路由层转成对应的 HTTP 响应。 */
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { ok: false, error: message });
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * 读取并解析 JSON 请求体。空请求体视为 {}。
 * 超过上限抛 413，非法 JSON 抛 400。
 */
function readJsonBody(req, { limit = MAX_JSON_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(new HttpError(413, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new HttpError(400, '请求体必须是一个 JSON 对象'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, '请求体不是合法 JSON'));
      }
    });

    req.on('error', (err) => fail(new HttpError(400, `读取请求体失败：${err.message}`)));
    req.on('aborted', () => fail(new HttpError(400, '请求被中断')));
  });
}

/**
 * 恒定时间比较口令。
 * 先把两边都做一次 SHA-256，长度就固定了，既避免 timingSafeEqual 对长度不等会抛错，
 * 也不会因为长度差异泄露信息。
 */
function verifyCode(expectedCode, providedCode) {
  const expected = crypto.createHash('sha256').update(String(expectedCode ?? ''), 'utf8').digest();
  const provided = crypto.createHash('sha256').update(String(providedCode ?? ''), 'utf8').digest();
  return crypto.timingSafeEqual(expected, provided);
}

/** 解析 Cookie 请求头。 */
function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

/**
 * 生成 Set-Cookie 的值。
 * 会话 cookie 固定 `HttpOnly` + `SameSite=Strict` —— 脚本读不到，跨站请求也不会带上。
 */
function serializeCookie(name, value, { maxAgeSeconds, httpOnly = true, sameSite = 'Strict', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (httpOnly) parts.push('HttpOnly');
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (typeof maxAgeSeconds === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  return parts.join('; ');
}

/** 生成一个不可预测的随机标识（会话 token、临时文件名后缀）。 */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
  HttpError,
  MAX_JSON_BODY_BYTES,
  sendJson,
  sendError,
  sendText,
  readJsonBody,
  verifyCode,
  parseCookies,
  serializeCookie,
  randomToken,
};
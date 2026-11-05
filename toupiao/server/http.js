import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/** 统一的 API 错误：最终序列化为 { error, message }。 */
export class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; " +
    "form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};

export function applySecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!res.hasHeader(name)) res.setHeader(name, value);
  }
}

export function sendJson(res, status, payload, headers = {}) {
  applySecurityHeaders(res);
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function sendError(res, status, code, message, headers = {}) {
  sendJson(res, status, { error: code, message }, headers);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', headers = {}) {
  applySecurityHeaders(res);
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function redirect(res, location, status = 302, headers = {}) {
  applySecurityHeaders(res);
  res.writeHead(status, {
    Location: location,
    'Cache-Control': 'no-store',
    'Content-Length': 0,
    ...headers,
  });
  res.end();
}

export function parseCookies(header) {
  const cookies = Object.create(null);
  if (!header || typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    cookies[name] = value;
  }
  return cookies;
}

export function serializeCookie(name, value, options = {}) {
  const {
    maxAge,
    path = '/',
    httpOnly = true,
    secure = false,
    sameSite = 'Lax',
  } = options;
  const parts = [`${name}=${value}`, `Path=${path}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (typeof maxAge === 'number') parts.push(`Max-Age=${Math.floor(maxAge)}`);
  return parts.join('; ');
}

export function appendSetCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookie]);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie]);
    return;
  }
  res.setHeader('Set-Cookie', [String(existing), cookie]);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function hmac(data, secret) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * 签名 token：base64url(JSON) + "." + HMAC。用于员工会话、管理员会话与 OAuth state。
 */
export function createToken(payload, secret, { ttlSeconds, now = Date.now() } = {}) {
  const issuedAt = Math.floor(now / 1000);
  const body = {
    ...payload,
    iat: issuedAt,
    exp: ttlSeconds ? issuedAt + Math.floor(ttlSeconds) : payload.exp,
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${encoded}.${hmac(encoded, secret)}`;
}

export function verifyToken(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = hmac(encoded, secret);
  if (!timingSafeEqualString(signature, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
  return payload;
}

export function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/**
 * 只接受站内路径，拒绝绝对 URL、协议相对 URL、反斜杠与控制字符，防开放重定向。
 */
export function sanitizeNextPath(raw, fallback = '/') {
  if (typeof raw !== 'string') return fallback;
  let value = raw.trim();
  if (!value || value.length > 512) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    value = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (!/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%?#[\]]*$/.test(value)) return fallback;
  return value;
}

/** RFC 4180 转义 + 电子表格公式注入防护（以 = + - @ 制表符或回车开头的字段前置单引号）。 */
export function csvEscape(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function csvRow(fields) {
  return fields.map(csvEscape).join(',');
}

export function csvDocument(header, rows) {
  const lines = [csvRow(header), ...rows.map((row) => csvRow(row))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function getClientIp(req, config) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
  }
  const remote = req.socket?.remoteAddress || 'unknown';
  return remote.startsWith('::ffff:') ? remote.slice(7) : remote;
}

export function isSecureRequest(req, config) {
  if (config.cookieSecure === 'true') return true;
  if (config.cookieSecure === 'false') return false;
  if (req.socket?.encrypted) return true;
  if (config.trustProxy) {
    const proto = req.headers['x-forwarded-proto'];
    if (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https') {
      return true;
    }
  }
  return config.publicBaseUrl.startsWith('https://');
}

/** 写操作的同源校验：无 Origin（如 curl）放行；有 Origin 必须与本站 / 开发地址一致。 */
export function isAllowedOrigin(req, config) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (origin === 'null') return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // Vite 开发地址只在非 production 下放行
  if (!config.isProduction && config.devOrigins.includes(url.origin)) return true;
  try {
    if (new URL(config.publicBaseUrl).origin === url.origin) return true;
  } catch {
    /* 配置已在启动时校验，这里只是兜底 */
  }
  const host = req.headers.host;
  if (host && url.host === host) return true;
  return false;
}

/**
 * 读取 JSON body，超过 64KB 返回 413，畸形 JSON 返回 400。
 * 空 body 返回 undefined。
 */
export async function readJsonBody(req, limit = 64 * 1024) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `请求体不能超过 ${limit} 字节`);
  }
  const chunks = [];
  let size = 0;
  await new Promise((resolvePromise, rejectPromise) => {
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        req.resume();
        finish(new HttpError(413, 'PAYLOAD_TOO_LARGE', `请求体不能超过 ${limit} 字节`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish());
    req.on('error', (error) => finish(error));
    req.on('aborted', () => finish(new HttpError(400, 'REQUEST_ABORTED', '请求被中断')));
  });
  if (size === 0) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'BAD_JSON', '请求体不是合法的 JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'BAD_JSON', '请求体必须是 JSON 对象');
  }
  return parsed;
}

/**
 * 读取原始二进制 body（如图标上传），超过 limit 返回 413，中断返回 400。
 * 空 body 返回空 Buffer，由调用方判断是否合法。
 */
export async function readBodyBuffer(req, limit = 5 * 1024 * 1024) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `请求体不能超过 ${limit} 字节`);
  }

  const chunks = [];
  let size = 0;
  await new Promise((resolvePromise, rejectPromise) => {
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        req.resume();
        finish(new HttpError(413, 'PAYLOAD_TOO_LARGE', `请求体不能超过 ${limit} 字节`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish());
    req.on('error', () => finish(new HttpError(400, 'REQUEST_ABORTED', '请求被中断')));
    req.on('aborted', () => finish(new HttpError(400, 'REQUEST_ABORTED', '请求被中断')));
  });

  return Buffer.concat(chunks, size);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function contentTypeFor(filePath) {
  const index = filePath.lastIndexOf('.');
  if (index < 0) return 'application/octet-stream';
  return MIME_TYPES[filePath.slice(index).toLowerCase()] || 'application/octet-stream';
}

/**
 * 输出本地静态文件；调用方负责路径白名单/根目录约束。
 */
export async function serveFile(req, res, filePath, options = {}) {
  const { contentType = contentTypeFor(filePath), cacheControl = 'no-cache', etag } = options;
  let info;
  try {
    info = await stat(filePath);
  } catch {
    sendError(res, 404, 'NOT_FOUND', '文件不存在');
    return;
  }
  if (!info.isFile()) {
    sendError(res, 404, 'NOT_FOUND', '文件不存在');
    return;
  }
  const tag = etag || `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === tag) {
    applySecurityHeaders(res);
    res.writeHead(304, { ETag: tag, 'Cache-Control': cacheControl });
    res.end();
    return;
  }
  applySecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': info.size,
    'Cache-Control': cacheControl,
    ETag: tag,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  try {
    await pipeline(createReadStream(filePath), res);
  } catch (error) {
    if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    if (!res.headersSent) sendError(res, 500, 'INTERNAL_ERROR', '读取文件失败');
    else res.destroy();
  }
}

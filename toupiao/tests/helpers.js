import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { createUserSessionToken } from '../server/auth.js';
import { loadConfig } from '../server/config.js';
import { createStore } from '../server/db.js';
import { createIconStore, scanIcons } from '../server/icons.js';

/** 1×1 透明 PNG，足够验证 Content-Type 与自然尺寸。 */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export const DEFAULT_ICON_FILES = [
  '01_无限连接.png',
  '02_脑机接口.png',
  '03_柔性神经电极.png',
  '04_神经网络.png',
  '05_E字母标志.png',
  '06_人机融合.png',
];

export function createSilentLogger() {
  const entries = [];
  return {
    entries,
    info: (...args) => entries.push({ level: 'info', args }),
    warn: (...args) => entries.push({ level: 'warn', args }),
    error: (...args) => entries.push({ level: 'error', args }),
  };
}

/**
 * 启动一个完全隔离的测试实例（临时 DATA_DIR + ICONS_DIR）。
 */
export async function startServer(options = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'toupiao-test-'));
  const cleanupDir = options.keepDir !== true;
  const iconsDir = options.iconsDir ?? join(dir, 'icons');
  const iconFiles = options.iconFiles ?? DEFAULT_ICON_FILES;

  if (!options.skipIcons) {
    mkdirSync(iconsDir, { recursive: true });
    for (const file of iconFiles) {
      writeFileSync(join(iconsDir, file), PNG_BYTES);
    }
  }

  const env = {
    NODE_ENV: 'test',
    ADMIN_PASSWORD: 'test-admin-123',
    SESSION_SECRET: 'test-session-secret-0123456789abcdef-xyz',
    PUBLIC_BASE_URL: '',
    DINGTALK_APP_KEY: '',
    DINGTALK_APP_SECRET: '',
    DINGTALK_CORP_ID: '',
    DINGTALK_TEST_BASE: '',
    DATA_DIR: join(dir, 'data'),
    ICONS_DIR: iconsDir,
    TRUST_PROXY: '0',
    ...options.env,
  };

  const config = loadConfig(env, { rootDir: dir });
  if (options.clientDir) config.clientDir = options.clientDir;

  const logger = options.logger ?? createSilentLogger();
  const store = createStore({ dataDir: config.dataDir, now: options.now, logger });
  const scan = scanIcons(config.iconsDir, { logger });
  const iconStore = createIconStore(scan);
  const app = createApp({
    config,
    store,
    iconStore,
    fetchImpl: options.fetchImpl,
    logger,
  });

  const server = createServer((req, res) => {
    app.handler(req, res).catch((error) => {
      logger.error?.('handler crashed', error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  let closed = false;
  return {
    base,
    dir,
    config,
    store,
    iconStore,
    scan,
    logger,
    server,
    loginLimiter: app.loginLimiter,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve) => server.close(resolve));
      store.close();
      if (cleanupDir) rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * 带 cookie jar 的测试客户端，默认不自动跟随重定向（便于断言跳转参数）。
 *
 * 第二个参数传 startServer() 的返回值，loginAs 才能直接写用户与会话 cookie；
 * 不传时只能做匿名/管理员请求。
 */
export function createClient(base, server = null) {
  const cookies = new Map();

  async function request(path, options = {}) {
    const {
      method = 'GET',
      body,
      rawBody,
      headers = {},
      redirect = 'manual',
    } = options;
    const requestHeaders = { ...headers };
    if (cookies.size > 0) {
      requestHeaders.cookie = [...cookies.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }
    let payload;
    if (rawBody !== undefined) {
      payload = rawBody;
    } else if (body !== undefined) {
      if (!requestHeaders['content-type']) requestHeaders['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await fetch(base + path, {
      method,
      headers: requestHeaders,
      body: payload,
      redirect,
    });

    const setCookieHeaders =
      typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const cookie of setCookieHeaders) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);
      if (!value || /;\s*Max-Age=0(?:;|$)/i.test(cookie)) cookies.delete(name);
      else cookies.set(name, value);
    }

    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return {
      status: response.status,
      headers: response.headers,
      text,
      json,
      setCookies: setCookieHeaders,
    };
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options = {}) => request(path, { ...options, method: 'POST', body }),
    put: (path, body, options = {}) => request(path, { ...options, method: 'PUT', body }),
    del: (path, options = {}) => request(path, { ...options, method: 'DELETE' }),
    cookies,
    setCookie(name, value) {
      cookies.set(name, value);
    },
    /**
     * 直接注入员工会话，绕过已删除的 HTTP mock 登录。
     * 同名用户复用同一个测试 unionId，行为与“同一钉钉用户重新登录”一致。
     */
    async loginAs(name = '测试员工') {
      if (!server?.store || !server?.config) {
        throw new Error('loginAs 需要传入 createClient(base, startServer()) 的返回值');
      }
      const unionId = `test:${name}`;
      const user = server.store.upsertUser({ unionId, nick: name, avatarUrl: '' });
      cookies.set('toupiao_session', createUserSessionToken(user.id, server.config));
      return user;
    },
    async loginAdmin(password = 'test-admin-123') {
      const response = await request('/api/admin/login', {
        method: 'POST',
        body: { password },
      });
      if (response.status !== 200) {
        throw new Error(`管理员登录失败：${response.status} ${response.text}`);
      }
      return response;
    },
  };
}

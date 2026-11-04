import { resolve } from 'node:path';

/**
 * 配置读取与校验。所有密钥只从环境变量（或 .env 文件）来，不落代码、不落日志。
 * 校验失败会抛出 ConfigError，由 index.js 打印可读错误并退出。
 */

const PLACEHOLDER_ADMIN_PASSWORDS = new Set(['change-me-now', 'changeme', 'admin', 'password']);
const PLACEHOLDER_SESSION_SECRETS = new Set([
  'replace-with-at-least-32-random-characters',
  'replace-me',
  'change-me',
]);
const AUTH_MODES = new Set(['dingtalk', 'mock']);
const COOKIE_SECURE_MODES = new Set(['auto', 'true', 'false']);

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(env, name) {
  const value = (env[name] ?? '').trim();
  if (!value) throw new ConfigError(`缺少必填环境变量 ${name}`);
  return value;
}

function optional(env, name, fallback) {
  const value = env[name];
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value).trim();
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT 必须是 1-65535 的整数，当前为 ${JSON.stringify(value)}`);
  }
  return port;
}

function parseBooleanMode(value, name) {
  const normalized = String(value).trim().toLowerCase();
  if (!COOKIE_SECURE_MODES.has(normalized)) {
    throw new ConfigError(`${name} 只能是 auto / true / false，当前为 ${JSON.stringify(value)}`);
  }
  return normalized;
}

function parseBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`PUBLIC_BASE_URL 不是合法 URL：${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('PUBLIC_BASE_URL 必须以 http:// 或 https:// 开头');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError('PUBLIC_BASE_URL 只能是站点根地址，不能带路径、查询串或锚点');
  }
  return url.origin;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ rootDir?: string }} [options]
 */
export function loadConfig(env = process.env, { rootDir = process.cwd() } = {}) {
  const authMode = optional(env, 'AUTH_MODE', '').toLowerCase();
  if (!AUTH_MODES.has(authMode)) {
    throw new ConfigError(
      `AUTH_MODE 必须显式设置为 dingtalk 或 mock（当前为 ${JSON.stringify(env.AUTH_MODE ?? '')}）`,
    );
  }

  const port = parsePort(optional(env, 'PORT', '3001'));
  const nodeEnv = optional(env, 'NODE_ENV', 'development');

  const adminPassword = required(env, 'ADMIN_PASSWORD');
  if (adminPassword.length < 8) {
    throw new ConfigError('ADMIN_PASSWORD 至少需要 8 个字符');
  }
  if (PLACEHOLDER_ADMIN_PASSWORDS.has(adminPassword.toLowerCase())) {
    throw new ConfigError('ADMIN_PASSWORD 仍是示例值，请改成自己的强口令');
  }

  const sessionSecret = required(env, 'SESSION_SECRET');
  if (sessionSecret.length < 32) {
    throw new ConfigError('SESSION_SECRET 至少需要 32 个字符（可用 openssl rand -hex 32 生成）');
  }
  if (PLACEHOLDER_SESSION_SECRETS.has(sessionSecret.toLowerCase())) {
    throw new ConfigError('SESSION_SECRET 仍是示例值，请换成随机串');
  }

  const publicBaseUrlRaw = optional(env, 'PUBLIC_BASE_URL', '');
  let publicBaseUrl;
  if (authMode === 'dingtalk') {
    if (!publicBaseUrlRaw) {
      throw new ConfigError('AUTH_MODE=dingtalk 时必须设置 PUBLIC_BASE_URL（如 https://vote.example.com）');
    }
    publicBaseUrl = parseBaseUrl(publicBaseUrlRaw);
  } else {
    publicBaseUrl = publicBaseUrlRaw ? parseBaseUrl(publicBaseUrlRaw) : `http://localhost:${port}`;
  }

  const dingtalk = {
    appKey: optional(env, 'DINGTALK_APP_KEY', ''),
    appSecret: optional(env, 'DINGTALK_APP_SECRET', ''),
    corpId: optional(env, 'DINGTALK_CORP_ID', ''),
  };
  if (authMode === 'dingtalk') {
    if (!dingtalk.appKey) throw new ConfigError('AUTH_MODE=dingtalk 时必须设置 DINGTALK_APP_KEY');
    if (!dingtalk.appSecret) throw new ConfigError('AUTH_MODE=dingtalk 时必须设置 DINGTALK_APP_SECRET');
  }

  const cookieSecure = parseBooleanMode(optional(env, 'COOKIE_SECURE', 'auto'), 'COOKIE_SECURE');
  const trustProxy = optional(env, 'TRUST_PROXY', '1') !== '0';

  return {
    authMode,
    isMock: authMode === 'mock',
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port,
    adminPassword,
    sessionSecret,
    publicBaseUrl,
    dingtalk,
    dataDir: resolve(rootDir, optional(env, 'DATA_DIR', './data')),
    iconsDir: resolve(rootDir, optional(env, 'ICONS_DIR', './assets/icons')),
    clientDir: resolve(rootDir, 'client/dist'),
    cookieSecure,
    trustProxy,
    bodyLimit: 64 * 1024,
    maxVotes: 5,
    sessionMaxAgeSeconds: 7 * 24 * 60 * 60,
    oauthStateMaxAgeSeconds: 10 * 60,
    adminLoginWindowMs: 5 * 60 * 1000,
    adminLoginMaxFailures: 10,
    devOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  };
}

import { resolve } from 'node:path';

/**
 * 配置读取与校验。
 *
 * 启动只需要 ADMIN_PASSWORD 与 SESSION_SECRET；钉钉凭据与站点地址都是可选的引导值，
 * 实际生效值由 server/dingtalk-config.js 按「数据库 > 环境变量」解析。
 * 校验失败会抛出 ConfigError，由 index.js 打印可读错误并退出。
 */

const PLACEHOLDER_ADMIN_PASSWORDS = new Set(['change-me-now', 'changeme', 'admin', 'password']);
const PLACEHOLDER_SESSION_SECRETS = new Set([
  'replace-with-at-least-32-random-characters',
  'replace-me',
  'change-me',
]);
const COOKIE_SECURE_MODES = new Set(['auto', 'true', 'false']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

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

function isLocalHostname(hostname) {
  return LOCAL_HOSTNAMES.has(String(hostname ?? '').toLowerCase());
}

function parseBaseUrl(raw, { name = 'PUBLIC_BASE_URL', isProduction = false } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} 不是合法 URL：${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`${name} 必须以 http:// 或 https:// 开头`);
  }
  if (url.username || url.password) {
    throw new ConfigError(`${name} 不能包含用户名或密码`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError(`${name} 只能是站点根地址，不能带路径、查询串或锚点`);
  }
  if (isProduction && url.protocol === 'http:' && !isLocalHostname(url.hostname)) {
    throw new ConfigError(`${name} 在生产环境必须使用 https://（localhost / 127.0.0.1 除外）`);
  }
  return url.origin;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ rootDir?: string }} [options]
 */
export function loadConfig(env = process.env, { rootDir = process.cwd() } = {}) {
  const port = parsePort(optional(env, 'PORT', '3001'));
  const nodeEnv = optional(env, 'NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';

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

  // 环境变量里的站点地址只是首次部署的引导值；未设置时用本机地址兜底，
  // 但钉钉配置解析不会把这个兜底值当作“已配置”。
  const publicBaseUrlRaw = optional(env, 'PUBLIC_BASE_URL', '');
  const envPublicBaseUrl = publicBaseUrlRaw
    ? parseBaseUrl(publicBaseUrlRaw, { name: 'PUBLIC_BASE_URL', isProduction })
    : '';
  const publicBaseUrl = envPublicBaseUrl || `http://localhost:${port}`;

  // 测试专用：仅在 NODE_ENV=test 时允许覆盖钉钉 endpoint；生产环境完全忽略。
  const testBaseRaw = nodeEnv === 'test' ? optional(env, 'DINGTALK_TEST_BASE', '') : '';
  const dingtalkTestBase = testBaseRaw
    ? parseBaseUrl(testBaseRaw, { name: 'DINGTALK_TEST_BASE' })
    : '';

  const dingtalk = {
    appKey: optional(env, 'DINGTALK_APP_KEY', ''),
    appSecret: optional(env, 'DINGTALK_APP_SECRET', ''),
    corpId: optional(env, 'DINGTALK_CORP_ID', ''),
  };

  const cookieSecure = parseBooleanMode(optional(env, 'COOKIE_SECURE', 'auto'), 'COOKIE_SECURE');
  const trustProxy = optional(env, 'TRUST_PROXY', '1') !== '0';

  return {
    nodeEnv,
    isProduction,
    port,
    adminPassword,
    sessionSecret,
    publicBaseUrl,
    envPublicBaseUrl,
    dingtalk,
    dingtalkTestBase,
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

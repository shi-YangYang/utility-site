import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';

/**
 * 钉钉登录配置：settings 表 > 环境变量 > 空。
 *
 * AppSecret 使用 AES-256-GCM 加密后落库，密钥由 SESSION_SECRET 经 HKDF 派生。
 * 对外只暴露 hasSecret，任何函数都不会把明文 secret 返回给调用方。
 */

export const DINGTALK_SETTING_KEYS = Object.freeze({
  appKey: 'dingtalk.app_key',
  appSecretEnc: 'dingtalk.app_secret_enc',
  corpId: 'dingtalk.corp_id',
  publicBaseUrl: 'dingtalk.public_base_url',
});

const SECRET_PREFIX = 'v1:';
const HKDF_INFO = 'toupiao-dingtalk-secret';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_APP_KEY_LENGTH = 128;
const MAX_APP_SECRET_LENGTH = 256;
const MAX_CORP_ID_LENGTH = 128;
const MAX_BASE_URL_LENGTH = 512;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** 每个 logger 只提示一次解密失败，避免每次 /api/state 刷屏。 */
const warnedLoggers = new WeakSet();

function deriveKey(sessionSecret) {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(String(sessionSecret ?? ''), 'utf8'),
      Buffer.alloc(0),
      Buffer.from(HKDF_INFO, 'utf8'),
      32,
    ),
  );
}

/** 加密为 `v1:base64url(iv|tag|ciphertext)`。 */
export function encryptSecret(plainText, sessionSecret) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(sessionSecret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plainText ?? ''), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

/** 解密失败（换 SESSION_SECRET、密文被篡改、格式不对）统一返回 null。 */
export function decryptSecret(encoded, sessionSecret) {
  if (typeof encoded !== 'string' || !encoded.startsWith(SECRET_PREFIX)) return null;
  const payload = encoded.slice(SECRET_PREFIX.length);
  if (!payload || !BASE64URL_PATTERN.test(payload)) return null;
  const raw = Buffer.from(payload, 'base64url');
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(sessionSecret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function readSetting(store, key) {
  const value = store.getSetting(key);
  return typeof value === 'string' ? value.trim() : '';
}

function pick(dbValue, envValue) {
  if (dbValue) return { value: dbValue, source: 'db' };
  if (envValue) return { value: envValue, source: 'env' };
  return { value: '', source: 'none' };
}

function warnDecryptFailure(logger) {
  const target = logger && typeof logger === 'object' ? logger : console;
  if (warnedLoggers.has(target)) return;
  warnedLoggers.add(target);
  target.warn?.(
    '[dingtalk] 已保存的 AppSecret 无法解密（SESSION_SECRET 是否更换过？），当前视为未配置；请在管理后台重新填写 AppSecret。',
  );
}

/**
 * 合并数据库与环境变量，返回当前生效配置（含明文 secret，仅供服务端内部使用）。
 * @returns {{
 *   appKey: string, appSecret: string, corpId: string, publicBaseUrl: string,
 *   callbackUrl: string, configured: boolean, hasSecret: boolean,
 *   source: 'db'|'env'|'mixed'|'none', secretDecryptFailed: boolean
 * }}
 */
export function resolveDingTalkSettings(store, config, { logger = console } = {}) {
  const env = config.dingtalk ?? {};
  const dbAppKey = readSetting(store, DINGTALK_SETTING_KEYS.appKey);
  const dbSecretEnc = readSetting(store, DINGTALK_SETTING_KEYS.appSecretEnc);
  const dbCorpId = readSetting(store, DINGTALK_SETTING_KEYS.corpId);
  const dbBaseUrl = readSetting(store, DINGTALK_SETTING_KEYS.publicBaseUrl);

  const envAppKey = String(env.appKey ?? '').trim();
  const envSecret = String(env.appSecret ?? '').trim();
  const envCorpId = String(env.corpId ?? '').trim();
  const envBaseUrl = String(config.envPublicBaseUrl ?? '').trim();

  const appKey = pick(dbAppKey, envAppKey);
  const corpId = pick(dbCorpId, envCorpId);
  const publicBaseUrl = pick(dbBaseUrl.replace(/\/+$/, ''), envBaseUrl.replace(/\/+$/, ''));

  let appSecret = '';
  let secretSource = 'none';
  let secretDecryptFailed = false;
  if (dbSecretEnc) {
    secretSource = 'db';
    const decrypted = decryptSecret(dbSecretEnc, config.sessionSecret);
    if (decrypted === null) {
      secretDecryptFailed = true;
      warnDecryptFailure(logger);
    } else {
      appSecret = decrypted;
    }
  } else if (envSecret) {
    appSecret = envSecret;
    secretSource = 'env';
  }

  const usedDb =
    appKey.source === 'db' ||
    corpId.source === 'db' ||
    publicBaseUrl.source === 'db' ||
    secretSource === 'db';
  const usedEnv =
    appKey.source === 'env' ||
    corpId.source === 'env' ||
    publicBaseUrl.source === 'env' ||
    secretSource === 'env';
  const source = usedDb && usedEnv ? 'mixed' : usedDb ? 'db' : usedEnv ? 'env' : 'none';

  const baseUrl = publicBaseUrl.value;
  const callbackUrl = baseUrl ? `${baseUrl}/api/auth/callback` : '';

  return {
    appKey: appKey.value,
    appSecret,
    corpId: corpId.value,
    publicBaseUrl: baseUrl,
    callbackUrl,
    configured: Boolean(appKey.value && appSecret && baseUrl),
    hasSecret: Boolean(appSecret),
    source,
    secretDecryptFailed,
  };
}

/** 管理 API 可见字段：绝不包含 appSecret / 密文。 */
export function publicDingTalkSettings(resolved) {
  return {
    configured: Boolean(resolved.configured),
    appKey: resolved.appKey,
    corpId: resolved.corpId,
    publicBaseUrl: resolved.publicBaseUrl,
    callbackUrl: resolved.callbackUrl,
    hasSecret: Boolean(resolved.hasSecret),
    source: resolved.source,
  };
}

function invalid(message) {
  return new HttpError(400, 'INVALID_DINGTALK_CONFIG', message);
}

function readTextField(value, name, maxLength) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw invalid(`${name} 必须是字符串`);
  const text = value.trim();
  if (CONTROL_CHARS.test(text)) throw invalid(`${name} 不能包含控制字符或换行`);
  if (text.length > maxLength) throw invalid(`${name} 不能超过 ${maxLength} 个字符`);
  return text;
}

function normalizeBaseUrl(raw) {
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw invalid('站点地址必须是合法的 http/https 地址');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalid('站点地址必须以 http:// 或 https:// 开头');
  }
  if (url.username || url.password) throw invalid('站点地址不能包含用户名或密码');
  if (url.pathname !== '/' || url.search || url.hash) {
    throw invalid('站点地址只能是站点根地址，不能带路径、查询串或锚点');
  }
  return url.origin;
}

/**
 * 校验并规范化 PUT /api/admin/dingtalk 的请求体。
 * 空字符串表示“清空该字段、回退到环境变量”，允许保存部分配置。
 */
export function validateDingTalkInput(input, { isProduction = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('请求体必须是 JSON 对象');
  }

  const appKey = readTextField(input.appKey, 'AppKey', MAX_APP_KEY_LENGTH);
  const corpId = readTextField(input.corpId, 'corpId', MAX_CORP_ID_LENGTH);
  const rawBaseUrl = readTextField(input.publicBaseUrl, '站点地址', MAX_BASE_URL_LENGTH);
  const publicBaseUrl = normalizeBaseUrl(rawBaseUrl);

  if (
    isProduction &&
    publicBaseUrl.startsWith('http://') &&
    !LOCAL_HOSTNAMES.has(new URL(publicBaseUrl).hostname.toLowerCase())
  ) {
    throw invalid('生产环境的站点地址必须使用 https://（localhost / 127.0.0.1 除外）');
  }

  let appSecret = '';
  if (input.appSecret !== undefined && input.appSecret !== null) {
    if (typeof input.appSecret !== 'string') throw invalid('AppSecret 必须是字符串');
    if (input.appSecret.length > 0) {
      if (input.appSecret.length > MAX_APP_SECRET_LENGTH) {
        throw invalid(`AppSecret 不能超过 ${MAX_APP_SECRET_LENGTH} 个字符`);
      }
      if (CONTROL_CHARS.test(input.appSecret)) {
        throw invalid('AppSecret 不能包含控制字符或换行');
      }
      if (input.appSecret.trim().length === 0) {
        throw invalid('AppSecret 不能只包含空白字符');
      }
      appSecret = input.appSecret;
    }
  }

  return { appKey, appSecret, corpId, publicBaseUrl };
}

/**
 * 保存配置。appSecret 省略/为空时保留原密文；首次配置必须提供。
 * 空字段会删除数据库值，从而回退到环境变量。
 */
export function saveDingTalkSettings(store, input, { config, logger = console } = {}) {
  const normalized = validateDingTalkInput(input, { isProduction: config.isProduction });
  const existing = resolveDingTalkSettings(store, config, { logger });

  if (!normalized.appSecret && !existing.appSecret) {
    throw new HttpError(400, 'SECRET_REQUIRED', '首次配置必须填写 AppSecret');
  }

  if (normalized.appKey) store.setSetting(DINGTALK_SETTING_KEYS.appKey, normalized.appKey);
  else store.deleteSetting(DINGTALK_SETTING_KEYS.appKey);

  if (normalized.corpId) store.setSetting(DINGTALK_SETTING_KEYS.corpId, normalized.corpId);
  else store.deleteSetting(DINGTALK_SETTING_KEYS.corpId);

  if (normalized.publicBaseUrl) {
    store.setSetting(DINGTALK_SETTING_KEYS.publicBaseUrl, normalized.publicBaseUrl);
  } else {
    store.deleteSetting(DINGTALK_SETTING_KEYS.publicBaseUrl);
  }

  if (normalized.appSecret) {
    store.setSetting(
      DINGTALK_SETTING_KEYS.appSecretEnc,
      encryptSecret(normalized.appSecret, config.sessionSecret),
    );
  }

  const resolved = resolveDingTalkSettings(store, config, { logger });
  logger.info?.(`[dingtalk] 登录配置已更新（来源：${resolved.source}）`);
  return publicDingTalkSettings(resolved);
}

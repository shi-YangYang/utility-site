import { createHash } from 'node:crypto';
import {
  HttpError,
  appendSetCookie,
  createToken,
  isSecureRequest,
  parseCookies,
  randomToken,
  serializeCookie,
  timingSafeEqualString,
  verifyToken,
} from './http.js';

export const USER_COOKIE = 'toupiao_session';
export const ADMIN_COOKIE = 'toupiao_admin';
export const OAUTH_STATE_COOKIE = 'toupiao_oauth_state';

export const DINGTALK_AUTHORIZE_URL = 'https://login.dingtalk.com/oauth2/auth';
export const DINGTALK_TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/userAccessToken';
export const DINGTALK_USERINFO_URL = 'https://api.dingtalk.com/v1.0/contact/users/me';

export class DingTalkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DingTalkError';
    this.code = code;
  }
}

// ---------- 会话 ----------

export function createUserSessionToken(userId, config, { now = Date.now() } = {}) {
  return createToken(
    { kind: 'user', uid: Number(userId) },
    config.sessionSecret,
    { ttlSeconds: config.sessionMaxAgeSeconds, now },
  );
}

export function createAdminSessionToken(config, { now = Date.now() } = {}) {
  return createToken(
    { kind: 'admin' },
    config.sessionSecret,
    { ttlSeconds: config.sessionMaxAgeSeconds, now },
  );
}

export function createOAuthStateToken(config, { state, next, now = Date.now() }) {
  return createToken(
    { kind: 'oauth', state, next },
    config.sessionSecret,
    { ttlSeconds: config.oauthStateMaxAgeSeconds, now },
  );
}

/**
 * @param {'user'|'admin'} kind
 * @returns {object|null}
 */
export function readSession(req, config, kind) {
  const cookieName = kind === 'admin' ? ADMIN_COOKIE : USER_COOKIE;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[cookieName];
  if (!token) return null;
  const payload = verifyToken(token, config.sessionSecret);
  if (!payload || payload.kind !== kind) return null;
  if (kind === 'user' && !Number.isInteger(payload.uid)) return null;
  return payload;
}

export function readOAuthState(req, config) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[OAUTH_STATE_COOKIE];
  if (!token) return null;
  const payload = verifyToken(token, config.sessionSecret);
  if (!payload || payload.kind !== 'oauth') return null;
  return payload;
}

function cookieOptions(req, config, maxAge) {
  return {
    maxAge,
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureRequest(req, config),
  };
}

export function setUserSession(res, req, userId, config, options = {}) {
  const token = createUserSessionToken(userId, config, options);
  appendSetCookie(
    res,
    serializeCookie(USER_COOKIE, token, cookieOptions(req, config, config.sessionMaxAgeSeconds)),
  );
}

export function setAdminSession(res, req, config, options = {}) {
  const token = createAdminSessionToken(config, options);
  appendSetCookie(
    res,
    serializeCookie(ADMIN_COOKIE, token, cookieOptions(req, config, config.sessionMaxAgeSeconds)),
  );
}

export function clearUserSession(res, req, config) {
  appendSetCookie(res, serializeCookie(USER_COOKIE, '', cookieOptions(req, config, 0)));
}

export function clearAdminSession(res, req, config) {
  appendSetCookie(res, serializeCookie(ADMIN_COOKIE, '', cookieOptions(req, config, 0)));
}

export function setOAuthStateCookie(res, req, config, token) {
  appendSetCookie(
    res,
    serializeCookie(
      OAUTH_STATE_COOKIE,
      token,
      cookieOptions(req, config, config.oauthStateMaxAgeSeconds),
    ),
  );
}

export function clearOAuthStateCookie(res, req, config) {
  appendSetCookie(res, serializeCookie(OAUTH_STATE_COOKIE, '', cookieOptions(req, config, 0)));
}

// ---------- 钉钉 OAuth2 ----------

export function callbackUrl(config) {
  return `${config.publicBaseUrl}/api/auth/callback`;
}

export function buildAuthorizeUrl(config, state) {
  const url = new URL(DINGTALK_AUTHORIZE_URL);
  url.searchParams.set('redirect_uri', callbackUrl(config));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.dingtalk.appKey);
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'consent');
  if (config.dingtalk.corpId) url.searchParams.set('corpId', config.dingtalk.corpId);
  return url.toString();
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function exchangeCodeForToken({ config, code, fetchImpl = globalThis.fetch }) {
  let response;
  try {
    response = await fetchImpl(DINGTALK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: config.dingtalk.appKey,
        clientSecret: config.dingtalk.appSecret,
        code,
        grantType: 'authorization_code',
      }),
    });
  } catch {
    throw new DingTalkError('NETWORK_ERROR', '无法连接钉钉授权服务');
  }
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new DingTalkError('TOKEN_EXCHANGE_FAILED', `钉钉 token 接口返回 HTTP ${response.status}`);
  }
  if (!data || typeof data.accessToken !== 'string' || !data.accessToken) {
    throw new DingTalkError('TOKEN_MISSING', '钉钉 token 响应缺少 accessToken');
  }
  return data.accessToken;
}

export async function fetchDingTalkUser({ accessToken, fetchImpl = globalThis.fetch }) {
  let response;
  try {
    response = await fetchImpl(DINGTALK_USERINFO_URL, {
      method: 'GET',
      headers: { 'x-acs-dingtalk-access-token': accessToken },
    });
  } catch {
    throw new DingTalkError('NETWORK_ERROR', '无法连接钉钉用户信息接口');
  }
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new DingTalkError('USERINFO_FAILED', `钉钉用户信息接口返回 HTTP ${response.status}`);
  }
  const unionId = data?.unionId || data?.unionid;
  if (typeof unionId !== 'string' || !unionId) {
    throw new DingTalkError('UNION_ID_MISSING', '钉钉用户信息缺少 unionId');
  }
  return {
    unionId,
    nick: typeof data.nick === 'string' && data.nick.trim() ? data.nick.trim() : '钉钉用户',
    avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : '',
  };
}

// ---------- mock ----------

export function normalizeMockName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name.length < 1 || name.length > 20) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

/** 以姓名生成稳定假 unionId：同名视为同一用户，重新登录不会产生新用户。 */
export function mockUnionId(name) {
  return `mock_${createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 40)}`;
}

export function createMockState() {
  return randomToken(24);
}

// ---------- 鉴权守卫 ----------

/** 员工会话；只要存在管理员会话就拒绝投票，篡改/过期视为未登录。 */
export function requireUser(req, config) {
  if (readSession(req, config, 'admin')) {
    throw new HttpError(
      403,
      'ADMIN_CANNOT_VOTE',
      '管理员会话不能投票，请先退出后台或换一个浏览器',
    );
  }
  const session = readSession(req, config, 'user');
  if (session) return session;
  throw new HttpError(401, 'AUTH_REQUIRED', '请先登录后再投票');
}

/** 管理接口：未登录 401，员工会话 403。 */
export function requireAdmin(req, config) {
  const session = readSession(req, config, 'admin');
  if (session) return session;
  if (readSession(req, config, 'user')) {
    throw new HttpError(403, 'ADMIN_REQUIRED', '需要管理员会话');
  }
  throw new HttpError(401, 'ADMIN_AUTH_REQUIRED', '请先登录管理后台');
}

export function verifyStatePayload(payload, expectedState) {
  if (!payload || payload.kind !== 'oauth') return null;
  if (typeof payload.state !== 'string' || typeof expectedState !== 'string') return null;
  if (!timingSafeEqualString(payload.state, expectedState)) return null;
  return payload;
}

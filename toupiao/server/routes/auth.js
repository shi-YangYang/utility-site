import {
  buildAuthorizeUrl,
  clearOAuthStateCookie,
  clearUserSession,
  createMockState,
  createOAuthStateToken,
  exchangeCodeForToken,
  fetchDingTalkUser,
  mockUnionId,
  normalizeMockName,
  readOAuthState,
  setOAuthStateCookie,
  setUserSession,
  verifyStatePayload,
} from '../auth.js';
import {
  HttpError,
  readJsonBody,
  redirect,
  sanitizeNextPath,
  sendJson,
} from '../http.js';
import { buildPublicState } from '../state.js';

/** GET /api/auth/login?next=/ → 302 到钉钉授权页（mock 模式禁用）。 */
export async function login(ctx) {
  const { req, res, config, url } = ctx;
  if (config.isMock) {
    throw new HttpError(400, 'MOCK_MODE', '当前为 mock 登录模式，请输入姓名登录');
  }
  const next = sanitizeNextPath(url.searchParams.get('next') ?? '/', '/');
  const state = createMockState();
  const token = createOAuthStateToken(config, { state, next });
  setOAuthStateCookie(res, req, config, token);
  redirect(res, buildAuthorizeUrl(config, state));
}

/** GET /api/auth/callback?code=&state= → 校验 state、换 token、取用户、写会话、302 回站内。 */
export async function callback(ctx) {
  const { req, res, config, url, store, fetchImpl, logger } = ctx;
  if (config.isMock) {
    throw new HttpError(404, 'NOT_FOUND', '钉钉回调仅在 AUTH_MODE=dingtalk 下可用');
  }

  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const dingtalkError = url.searchParams.get('error');
  const stateToken = readOAuthState(req, config);
  clearOAuthStateCookie(res, req, config);

  if (dingtalkError) {
    logger.warn?.(`[auth] 钉钉回调返回错误：${dingtalkError}`);
    redirect(res, '/?auth_error=DENIED');
    return;
  }

  const verified = verifyStatePayload(stateToken, state);
  if (!verified) {
    logger.warn?.('[auth] OAuth state 校验失败，未建立会话');
    redirect(res, '/?auth_error=STATE_INVALID');
    return;
  }
  if (!code) {
    redirect(res, '/?auth_error=CODE_MISSING');
    return;
  }

  try {
    const accessToken = await exchangeCodeForToken({ config, code, fetchImpl });
    const profile = await fetchDingTalkUser({ accessToken, fetchImpl });
    const user = store.upsertUser(profile);
    setUserSession(res, req, user.id, config);
    logger.info?.(`[auth] 钉钉用户登录成功 id=${user.id}`);
    redirect(res, sanitizeNextPath(verified.next, '/'));
  } catch (error) {
    logger.warn?.(`[auth] 钉钉登录失败：${error.code ?? 'ERROR'} ${error.message}`);
    redirect(res, '/?auth_error=LOGIN_FAILED');
  }
}

/** POST /api/auth/mock {name} → 仅 AUTH_MODE=mock 可用。 */
export async function mockLogin(ctx) {
  const { req, res, config, store } = ctx;
  if (!config.isMock) {
    throw new HttpError(404, 'NOT_FOUND', 'mock 登录未启用');
  }
  const body = (await readJsonBody(req, config.bodyLimit)) ?? {};
  const name = normalizeMockName(body.name);
  if (!name) {
    throw new HttpError(400, 'INVALID_NAME', '姓名需为 1-20 个字符（不含控制字符）');
  }
  const user = store.upsertUser({ unionId: mockUnionId(name), nick: name, avatarUrl: '' });
  setUserSession(res, req, user.id, config);
  sendJson(res, 200, {
    ok: true,
    authMode: 'mock',
    user: { nick: user.nick, avatarUrl: user.avatar_url || '' },
    state: buildPublicState({
      store,
      iconStore: ctx.iconStore,
      config,
      session: { uid: user.id },
    }),
  });
}

/** POST /api/auth/logout → 清除员工会话。 */
export async function logout(ctx) {
  clearUserSession(ctx.res, ctx.req, ctx.config);
  sendJson(ctx.res, 200, { ok: true });
}

import {
  buildAuthorizeUrl,
  clearOAuthStateCookie,
  clearUserSession,
  createOAuthState,
  createOAuthStateToken,
  exchangeCodeForToken,
  fetchDingTalkUser,
  readOAuthState,
  setOAuthStateCookie,
  setUserSession,
  verifyStatePayload,
} from '../auth.js';
import { resolveDingTalkSettings } from '../dingtalk-config.js';
import { redirect, sanitizeNextPath, sendJson } from '../http.js';

/** GET /api/auth/login?next=/ → 未配置时回首页提示，已配置时 302 到钉钉授权页。 */
export async function login(ctx) {
  const { req, res, config, store, logger } = ctx;
  const settings = resolveDingTalkSettings(store, config, { logger });
  if (!settings.configured) {
    redirect(res, '/?auth_error=AUTH_NOT_CONFIGURED');
    return;
  }

  const next = sanitizeNextPath(ctx.url.searchParams.get('next') ?? '/', '/');
  const state = createOAuthState();
  const token = createOAuthStateToken(config, { state, next });
  setOAuthStateCookie(res, req, config, token);
  redirect(res, buildAuthorizeUrl(settings, state, config));
}

/** GET /api/auth/callback?code=&state= → 校验 state、换 token、取用户、写会话、302 回站内。 */
export async function callback(ctx) {
  const { req, res, config, store, fetchImpl, logger } = ctx;
  const settings = resolveDingTalkSettings(store, config, { logger });

  const state = ctx.url.searchParams.get('state') ?? '';
  const code = ctx.url.searchParams.get('code') ?? '';
  const dingtalkError = ctx.url.searchParams.get('error');
  const stateToken = readOAuthState(req, config);
  clearOAuthStateCookie(res, req, config);

  if (!settings.configured) {
    logger.warn?.('[auth] 钉钉登录尚未配置，回调被拒绝');
    redirect(res, '/?auth_error=AUTH_NOT_CONFIGURED');
    return;
  }

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
    const accessToken = await exchangeCodeForToken({ config, settings, code, fetchImpl });
    const profile = await fetchDingTalkUser({ config, accessToken, fetchImpl });
    const user = store.upsertUser(profile);
    setUserSession(res, req, user.id, config);
    logger.info?.(`[auth] 钉钉用户登录成功 id=${user.id}`);
    redirect(res, sanitizeNextPath(verified.next, '/'));
  } catch (error) {
    logger.warn?.(`[auth] 钉钉登录失败：${error.code ?? 'ERROR'} ${error.message}`);
    redirect(res, '/?auth_error=LOGIN_FAILED');
  }
}

/** POST /api/auth/logout → 清除员工会话。 */
export async function logout(ctx) {
  clearUserSession(ctx.res, ctx.req, ctx.config);
  sendJson(ctx.res, 200, { ok: true });
}

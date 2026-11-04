import { clearAdminSession, requireAdmin, setAdminSession } from '../auth.js';
import {
  HttpError,
  applySecurityHeaders,
  csvDocument,
  getClientIp,
  readJsonBody,
  sendJson,
  timingSafeEqualString,
} from '../http.js';
import {
  buildAdminState,
  buildVoters,
  formatLocalDate,
  formatLocalDateTime,
  iconNameFor,
} from '../state.js';

/** POST /api/admin/login {password} */
export async function login(ctx) {
  const { req, res, config, logger } = ctx;
  const ip = getClientIp(req, config);
  const key = `admin-login:${ip}`;
  const limit = ctx.loginLimiter.check(key);
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', '尝试次数过多，请稍后再试', {
      'Retry-After': String(retryAfter),
    });
  }

  const body = (await readJsonBody(req, config.bodyLimit)) ?? {};
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || !timingSafeEqualString(password, config.adminPassword)) {
    ctx.loginLimiter.record(key);
    logger.warn?.(`[admin] 管理口令验证失败 ip=${ip}`);
    throw new HttpError(401, 'INVALID_PASSWORD', '管理口令不正确');
  }

  ctx.loginLimiter.reset(key);
  setAdminSession(res, req, config);
  logger.info?.('[admin] 管理员登录成功');
  sendJson(res, 200, { ok: true, authMode: config.authMode });
}

/** POST /api/admin/logout */
export async function logout(ctx) {
  requireAdmin(ctx.req, ctx.config);
  clearAdminSession(ctx.res, ctx.req, ctx.config);
  sendJson(ctx.res, 200, { ok: true });
}

/** GET /api/admin/state */
export async function state(ctx) {
  requireAdmin(ctx.req, ctx.config);
  sendJson(
    ctx.res,
    200,
    buildAdminState({
      store: ctx.store,
      iconStore: ctx.iconStore,
      config: ctx.config,
    }),
  );
}

/** GET /api/admin/voters */
export async function voters(ctx) {
  requireAdmin(ctx.req, ctx.config);
  sendJson(
    ctx.res,
    200,
    buildVoters({ store: ctx.store, iconStore: ctx.iconStore }),
  );
}

/** PUT /api/admin/settings {votingOpen} */
export async function settings(ctx) {
  requireAdmin(ctx.req, ctx.config);
  const { req, res, config, store, logger } = ctx;
  const body = (await readJsonBody(req, config.bodyLimit)) ?? {};
  if (typeof body.votingOpen !== 'boolean') {
    throw new HttpError(400, 'INVALID_SETTING', 'votingOpen 必须是布尔值');
  }
  const votingOpen = store.setVotingOpen(body.votingOpen);
  logger.info?.(`[admin] 投票已${votingOpen ? '开启' : '关闭'}`);
  sendJson(res, 200, { ok: true, votingOpen });
}

/** POST /api/admin/reset {confirm:"RESET"} */
export async function reset(ctx) {
  requireAdmin(ctx.req, ctx.config);
  const { req, res, config, store, logger } = ctx;
  const body = (await readJsonBody(req, config.bodyLimit)) ?? {};
  if (body.confirm !== 'RESET') {
    throw new HttpError(400, 'CONFIRM_REQUIRED', '请输入大写的 RESET 确认重置');
  }
  const removed = store.resetVotes();
  logger.info?.(`[admin] 管理员重置了投票，清除 ${removed} 票，时间 ${new Date().toISOString()}`);
  sendJson(res, 200, { ok: true, totalVotes: 0, removed });
}

/** GET /api/admin/export.csv → UTF-8 BOM + RFC 4180 + 公式注入防护 */
export async function exportCsv(ctx) {
  requireAdmin(ctx.req, ctx.config);
  const { res, store, iconStore } = ctx;
  const rows = store.getExportRows().map((row) => [
    row.nick,
    row.icon_id,
    iconNameFor(iconStore, row.icon_id),
    formatLocalDateTime(row.created_at),
  ]);
  const csv = csvDocument(['姓名', '图标编号', '图标名称', '投票时间'], rows);
  const body = Buffer.from(csv, 'utf8');
  applySecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="toupiao-${formatLocalDate()}.csv"`,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

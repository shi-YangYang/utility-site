import { readSession } from '../auth.js';
import { sendJson } from '../http.js';
import { buildPublicState } from '../state.js';

export async function health(ctx) {
  sendJson(ctx.res, 200, {
    ok: true,
    uptime: Math.round(process.uptime()),
  });
}

export async function state(ctx) {
  const session = readSession(ctx.req, ctx.config, 'user');
  sendJson(
    ctx.res,
    200,
    buildPublicState({
      store: ctx.store,
      iconStore: ctx.iconStore,
      config: ctx.config,
      session,
      logger: ctx.logger,
    }),
  );
}

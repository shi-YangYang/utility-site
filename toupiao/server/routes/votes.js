import { requireUser } from '../auth.js';
import { HttpError, sendJson } from '../http.js';
import { buildVoteSnapshot } from '../state.js';

function iconIdFrom(ctx) {
  const raw = ctx.params.iconId ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'ICON_NOT_FOUND', '图标不存在');
  }
}

async function mutate(ctx, action) {
  const { req, res, config, store, iconStore } = ctx;
  const iconId = iconIdFrom(ctx);
  if (!iconStore.getById(iconId)) {
    throw new HttpError(404, 'ICON_NOT_FOUND', '图标不存在');
  }
  const session = requireUser(req, config);
  const user = store.getUserById(session.uid);
  if (!user) {
    throw new HttpError(401, 'AUTH_REQUIRED', '登录已失效，请重新登录');
  }

  const status =
    action === 'add'
      ? store.addVote({ userId: user.id, iconId, maxVotes: config.maxVotes })
      : store.removeVote({ userId: user.id, iconId });

  if (status === 'closed') {
    throw new HttpError(403, 'VOTING_CLOSED', '投票已结束，无法修改投票');
  }
  if (status === 'limit') {
    throw new HttpError(
      409,
      'LIMIT_REACHED',
      `每人最多投 ${config.maxVotes} 个图标，请先取消一个再投`,
    );
  }

  sendJson(
    res,
    200,
    buildVoteSnapshot({ store, iconStore, config, userId: user.id }),
  );
}

/** PUT /api/votes/:iconId → 新增一票（重复投票幂等成功）。 */
export async function add(ctx) {
  await mutate(ctx, 'add');
}

/** DELETE /api/votes/:iconId → 取消一票（未投过幂等成功）。 */
export async function remove(ctx) {
  await mutate(ctx, 'remove');
}

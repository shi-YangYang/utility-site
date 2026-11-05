/**
 * 把数据库聚合与图标扫描结果组合成前端/后台可用的状态。
 * 前台状态绝不包含投票人列表、unionId 或任何会话信息。
 */

import { resolveDingTalkSettings } from './dingtalk-config.js';

export function rankIcons(icons, countMap) {
  const counts = icons.map((icon) => countMap.get(icon.id) ?? 0);
  return icons.map((icon, index) => {
    const count = counts[index];
    const rank = 1 + counts.filter((other) => other > count).length;
    return { ...icon, count, rank };
  });
}

export function iconNameFor(iconStore, iconId) {
  return iconStore.getById(iconId)?.name ?? iconId;
}

export function buildPublicState({ store, iconStore, config, session = null, logger = console }) {
  const totals = store.getTotals();
  const dingtalk = resolveDingTalkSettings(store, config, { logger });
  const icons = rankIcons(iconStore.icons, store.getIconCounts());

  let user = null;
  let myVotes = [];
  if (session) {
    const row = store.getUserById(session.uid);
    if (row) {
      user = { nick: row.nick, avatarUrl: row.avatar_url || '' };
      myVotes = store
        .getVotesForUser(session.uid)
        .map((vote) => vote.icon_id)
        .filter((iconId) => iconStore.getById(iconId) !== null);
    }
  }

  return {
    loginConfigured: dingtalk.configured,
    votingOpen: store.isVotingOpen(),
    maxVotes: config.maxVotes,
    totalVotes: totals.totalVotes,
    votersCount: totals.votersCount,
    user,
    myVotes,
    icons,
    iconsAvailable: iconStore.available,
  };
}

/** 投票写操作后返回的最新快照（不含用户身份信息，只有自己的 iconId 列表）。 */
export function buildVoteSnapshot({ store, iconStore, config, userId }) {
  const totals = store.getTotals();
  const icons = rankIcons(iconStore.icons, store.getIconCounts());
  return {
    myVotes: store
      .getVotesForUser(userId)
      .map((vote) => vote.icon_id)
      .filter((iconId) => iconStore.getById(iconId) !== null),
    icons,
    totalVotes: totals.totalVotes,
    votersCount: totals.votersCount,
    votingOpen: store.isVotingOpen(),
    maxVotes: config.maxVotes,
  };
}

export function buildAdminState({ store, iconStore, config, logger = console }) {
  const totals = store.getTotals();
  const dingtalk = resolveDingTalkSettings(store, config, { logger });
  const icons = rankIcons(iconStore.icons, store.getIconCounts()).map((icon) => ({
    ...icon,
    share: totals.totalVotes > 0 ? Math.round((icon.count / totals.totalVotes) * 1000) / 10 : 0,
  }));
  const recentVotes = store.getRecentVotes(20).map((row) => ({
    nick: row.nick,
    iconId: row.icon_id,
    iconName: iconNameFor(iconStore, row.icon_id),
    createdAt: row.created_at,
  }));

  return {
    votingOpen: store.isVotingOpen(),
    totalVotes: totals.totalVotes,
    votersCount: totals.votersCount,
    userCount: totals.userCount,
    iconCount: iconStore.icons.length,
    maxVotes: config.maxVotes,
    icons,
    recentVotes,
    iconsAvailable: iconStore.available,
    dingtalkConfigured: dingtalk.configured,
    publicBaseUrl: dingtalk.publicBaseUrl,
  };
}

export function buildVoters({ store, iconStore }) {
  return store.getVoters().map((voter) => ({
    nick: voter.nick,
    avatarUrl: voter.avatarUrl,
    lastVotedAt: voter.lastVotedAt,
    votes: voter.votes.map((vote) => ({
      iconId: vote.iconId,
      iconName: iconNameFor(iconStore, vote.iconId),
      createdAt: vote.createdAt,
    })),
  }));
}

const pad = (value) => String(value).padStart(2, '0');

/** 服务器本地时区的 YYYY-MM-DD HH:mm:ss。 */
export function formatLocalDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** 服务器本地时区的 YYYY-MM-DD。 */
export function formatLocalDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

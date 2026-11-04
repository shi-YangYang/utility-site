import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient, startServer } from './helpers.js';

test('管理接口鉴权：未登录 401、员工会话 403、错误口令 401、正确口令成功', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const anonymous = createClient(server.base);
  let response = await anonymous.get('/api/admin/state');
  assert.equal(response.status, 401);
  assert.equal(response.json.error, 'ADMIN_AUTH_REQUIRED');

  const employee = createClient(server.base);
  await employee.login('普通员工');
  response = await employee.get('/api/admin/state');
  assert.equal(response.status, 403);
  assert.equal(response.json.error, 'ADMIN_REQUIRED');

  const client = createClient(server.base);
  response = await client.post('/api/admin/login', { password: 'wrong-password' });
  assert.equal(response.status, 401);
  assert.equal(response.json.error, 'INVALID_PASSWORD');
  const logText = JSON.stringify(server.logger.entries);
  assert.equal(logText.includes('wrong-password'), false, '日志不能记录尝试的口令');
  assert.equal(logText.includes('test-admin-123'), false, '日志不能记录管理口令');
  response = await client.post('/api/admin/login', {});
  assert.equal(response.status, 401);

  const login = await client.loginAdmin();
  assert.equal(login.json.ok, true);
  assert.match(login.setCookies.join('\n'), /toupiao_admin=/);
  assert.match(login.setCookies.join('\n'), /HttpOnly/);
  assert.match(login.setCookies.join('\n'), /SameSite=Lax/);
  assert.match(login.setCookies.join('\n'), /Max-Age=604800/);

  response = await client.get('/api/admin/state');
  assert.equal(response.status, 200);
  assert.equal(response.json.votingOpen, true);
  assert.equal(response.json.totalVotes, 0);
  assert.equal(response.json.maxVotes, 5);

  const logout = await client.post('/api/admin/logout');
  assert.equal(logout.status, 200);
  response = await client.get('/api/admin/state');
  assert.equal(response.status, 401);

  const forbiddenLogout = await employee.post('/api/admin/logout');
  assert.equal(forbiddenLogout.status, 403);
});

test('管理登录限流：每 IP 5 分钟最多 10 次失败', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = createClient(server.base);

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const response = await client.post('/api/admin/login', { password: `wrong-${attempt}` });
    assert.equal(response.status, 401, `第 ${attempt} 次失败应返回 401`);
  }

  const blocked = await client.post('/api/admin/login', { password: 'test-admin-123' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, 'TOO_MANY_ATTEMPTS');
  const retryAfter = Number(blocked.headers.get('retry-after'));
  assert.ok(Number.isFinite(retryAfter) && retryAfter > 0);

  const otherServer = await startServer();
  t.after(() => otherServer.close());
  const fresh = createClient(otherServer.base);
  const success = await fresh.loginAdmin();
  assert.equal(success.status, 200);
});

test('后台总览与投票人明细：统计、排名、占比、隐私边界', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const first = createClient(server.base);
  const second = createClient(server.base);
  const admin = createClient(server.base);
  await first.login('用户甲');
  await second.login('用户乙');
  await first.put('/api/votes/01');
  await first.put('/api/votes/02');
  await second.put('/api/votes/01');
  await admin.loginAdmin();

  const state = await admin.get('/api/admin/state');
  assert.equal(state.status, 200);
  assert.equal(state.json.totalVotes, 3);
  assert.equal(state.json.votersCount, 2);
  assert.equal(state.json.userCount, 2);
  assert.equal(state.json.iconCount, 6);
  assert.equal(state.json.authMode, 'mock');
  assert.ok(state.json.publicBaseUrl.startsWith('http://localhost:'));

  const icon01 = state.json.icons.find((icon) => icon.id === '01');
  assert.equal(icon01.count, 2);
  assert.equal(icon01.rank, 1);
  assert.equal(icon01.share, 66.7);
  const icon02 = state.json.icons.find((icon) => icon.id === '02');
  assert.equal(icon02.count, 1);
  assert.equal(icon02.rank, 2);
  assert.equal(icon02.share, 33.3);
  const icon03 = state.json.icons.find((icon) => icon.id === '03');
  assert.equal(icon03.count, 0);
  assert.equal(icon03.rank, 3);
  assert.equal(icon03.share, 0);

  assert.equal(state.json.recentVotes.length, 3);
  for (const vote of state.json.recentVotes) {
    assert.ok(vote.nick);
    assert.ok(vote.iconId);
    assert.ok(vote.iconName);
    assert.ok(vote.createdAt);
  }

  const voters = await admin.get('/api/admin/voters');
  assert.equal(voters.status, 200);
  assert.equal(voters.json.length, 2);
  const latest = voters.json[0];
  assert.equal(latest.nick, '用户乙');
  assert.deepEqual(latest.votes.map((vote) => vote.iconId), ['01']);
  assert.equal(latest.votes[0].iconName, '无限连接');
  assert.ok(latest.lastVotedAt);
  const firstVoter = voters.json.find((voter) => voter.nick === '用户甲');
  assert.deepEqual(firstVoter.votes.map((vote) => vote.iconId).sort(), ['01', '02']);

  const serialized = JSON.stringify({ state: state.json, voters: voters.json });
  assert.equal(serialized.includes('union_id'), false);
  assert.equal(serialized.includes('unionId'), false);
  assert.equal(serialized.includes('toupiao_session'), false);
  assert.equal(serialized.includes('test-admin-123'), false);
});

test('开关投票：参数校验、立即生效、公开状态同步', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const admin = createClient(server.base);
  const publicClient = createClient(server.base);
  await admin.loginAdmin();

  let response = await admin.put('/api/admin/settings', { votingOpen: 'yes' });
  assert.equal(response.status, 400);
  assert.equal(response.json.error, 'INVALID_SETTING');

  response = await admin.put('/api/admin/settings', {});
  assert.equal(response.status, 400);

  response = await admin.put('/api/admin/settings', { votingOpen: false });
  assert.equal(response.status, 200);
  assert.equal(response.json.votingOpen, false);
  let publicState = await publicClient.get('/api/state');
  assert.equal(publicState.json.votingOpen, false);

  const reopen = await admin.put('/api/admin/settings', { votingOpen: true });
  assert.equal(reopen.json.votingOpen, true);
  publicState = await publicClient.get('/api/state');
  assert.equal(publicState.json.votingOpen, true);
});

test('重置：确认词校验、只清投票保留用户、统计归零', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const first = createClient(server.base);
  const second = createClient(server.base);
  const admin = createClient(server.base);
  await first.login('重置甲');
  await second.login('重置乙');
  await first.put('/api/votes/01');
  await first.put('/api/votes/02');
  await second.put('/api/votes/03');
  await admin.loginAdmin();

  let response = await admin.post('/api/admin/reset', { confirm: 'reset' });
  assert.equal(response.status, 400);
  assert.equal(response.json.error, 'CONFIRM_REQUIRED');
  let state = await admin.get('/api/admin/state');
  assert.equal(state.json.totalVotes, 3, '确认词错误时不能清空');

  response = await admin.post('/api/admin/reset', { confirm: 'RESET' });
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.totalVotes, 0);

  state = await admin.get('/api/admin/state');
  assert.equal(state.json.totalVotes, 0);
  assert.equal(state.json.votersCount, 0);
  assert.equal(state.json.userCount, 2, '重置必须保留用户');
  const voters = await admin.get('/api/admin/voters');
  assert.deepEqual(voters.json, []);
  assert.equal(server.store.getTotals().totalVotes, 0);

  const stillLoggedIn = await first.get('/api/state');
  assert.equal(stillLoggedIn.json.user.nick, '重置甲');
  assert.deepEqual(stillLoggedIn.json.myVotes, []);

  const employee = createClient(server.base);
  await employee.login('无权限');
  response = await employee.post('/api/admin/reset', { confirm: 'RESET' });
  assert.equal(response.status, 403);
});

test('CSV 导出：BOM、表头、RFC 4180 转义、公式注入防护、数据一致', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const commaUser = server.store.upsertUser({
    unionId: 'csv-comma',
    nick: '王,五"新\n行',
    avatarUrl: '',
  });
  server.store.addVote({ userId: commaUser.id, iconId: '01' });
  const formulaUser = server.store.upsertUser({
    unionId: 'csv-formula',
    nick: '=SUM(A1:A2)',
    avatarUrl: '',
  });
  server.store.addVote({ userId: formulaUser.id, iconId: '02' });
  const minusUser = server.store.upsertUser({
    unionId: 'csv-minus',
    nick: '-1+1',
    avatarUrl: '',
  });
  server.store.addVote({ userId: minusUser.id, iconId: '03' });

  const admin = createClient(server.base);
  await admin.loginAdmin();
  const cookie = [...admin.cookies.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  const response = await fetch(`${server.base}/api/admin/export.csv`, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/csv; charset=utf-8/);
  assert.match(
    response.headers.get('content-disposition') ?? '',
    /^attachment; filename="toupiao-\d{4}-\d{2}-\d{2}\.csv"$/,
  );

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'CSV 必须以 UTF-8 BOM 开头');
  const text = buffer.toString('utf8').slice(1);
  const lines = text.split('\r\n');
  assert.equal(lines[0], '姓名,图标编号,图标名称,投票时间');
  assert.equal(lines.at(-1), '');
  const dataLines = lines.slice(1, -1);
  assert.equal(dataLines.length, 3);

  assert.ok(
    text.includes('"王,五""新\n行",01,无限连接,'),
    '逗号、引号、换行必须按 RFC 4180 转义',
  );
  assert.ok(
    text.includes("'=SUM(A1:A2),02,脑机接口,"),
    '以 = 开头的字段必须防止公式注入',
  );
  assert.ok(text.includes("'-1+1,03,柔性神经电极,"), '以 - 开头的字段必须防止公式注入');
  for (const line of dataLines) {
    assert.match(line, /,\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  }

  const expectedRows = server.store.getExportRows();
  assert.equal(dataLines.length, expectedRows.length);
  for (const iconId of new Set(expectedRows.map((row) => row.icon_id))) {
    const iconName = server.iconStore.getById(iconId).name;
    assert.ok(text.includes(iconName), `CSV 应包含图标名称 ${iconName}`);
  }

  const unauthorized = await fetch(`${server.base}/api/admin/export.csv`, {
    redirect: 'manual',
  });
  assert.equal(unauthorized.status, 401);
});

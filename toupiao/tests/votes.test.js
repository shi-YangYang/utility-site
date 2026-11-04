import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient, startServer } from './helpers.js';

test('投票权限：未登录 401、管理员会话 403、图标不存在 404', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const anonymous = createClient(server.base);
  let response = await anonymous.put('/api/votes/01');
  assert.equal(response.status, 401);
  assert.equal(response.json.error, 'AUTH_REQUIRED');

  const adminOnly = createClient(server.base);
  await adminOnly.loginAdmin();
  response = await adminOnly.put('/api/votes/01');
  assert.equal(response.status, 403);
  assert.equal(response.json.error, 'ADMIN_CANNOT_VOTE');

  const bothSessions = createClient(server.base);
  await bothSessions.login('同时登录的员工');
  await bothSessions.loginAdmin();
  response = await bothSessions.put('/api/votes/01');
  assert.equal(response.status, 403, '只要存在管理员会话就不能投票');
  assert.equal(response.json.error, 'ADMIN_CANNOT_VOTE');
  response = await bothSessions.del('/api/votes/01');
  assert.equal(response.status, 403);
  assert.equal(server.store.getTotals().totalVotes, 0);

  const employee = createClient(server.base);
  await employee.login('投票员工');
  response = await employee.put('/api/votes/99');
  assert.equal(response.status, 404);
  assert.equal(response.json.error, 'ICON_NOT_FOUND');
  response = await employee.del('/api/votes/99');
  assert.equal(response.status, 404);
});

test('5 票上限、重复投票幂等、取消与改投', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = createClient(server.base);
  await client.login('张三');

  for (const [index, id] of ['01', '02', '03', '04', '05'].entries()) {
    const response = await client.put(`/api/votes/${id}`);
    assert.equal(response.status, 200, `第 ${index + 1} 票应该成功`);
    assert.equal(response.json.myVotes.length, index + 1);
    assert.equal(response.json.totalVotes, index + 1);
  }

  const sixth = await client.put('/api/votes/06');
  assert.equal(sixth.status, 409);
  assert.equal(sixth.json.error, 'LIMIT_REACHED');
  assert.match(sixth.json.message, /最多投 5 个/);

  let state = await client.get('/api/state');
  assert.equal(state.json.myVotes.length, 5);
  assert.equal(state.json.totalVotes, 5);
  assert.deepEqual(state.json.myVotes, ['01', '02', '03', '04', '05']);

  const duplicate = await client.put('/api/votes/01');
  assert.equal(duplicate.status, 200, '重复投票应该幂等成功');
  assert.equal(duplicate.json.totalVotes, 5);
  assert.equal(duplicate.json.myVotes.length, 5);
  assert.equal(server.store.getTotals().totalVotes, 5);

  const remove = await client.del('/api/votes/03');
  assert.equal(remove.status, 200);
  assert.equal(remove.json.myVotes.length, 4);
  assert.equal(remove.json.totalVotes, 4);
  assert.equal(server.store.getTotals().totalVotes, 4);

  const removeAgain = await client.del('/api/votes/03');
  assert.equal(removeAgain.status, 200, '取消不存在的票应幂等成功');
  assert.equal(removeAgain.json.totalVotes, 4);

  const change = await client.put('/api/votes/06');
  assert.equal(change.status, 200, '取消后可以改投');
  assert.deepEqual(change.json.myVotes.sort(), ['01', '02', '04', '05', '06']);
  assert.equal(change.json.totalVotes, 5);
});

test('并发 6 个投票请求：最多 5 个成功，1 个 409', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = createClient(server.base);
  await client.login('并发用户');

  const ids = ['01', '02', '03', '04', '05', '06'];
  const responses = await Promise.all(ids.map((id) => client.put(`/api/votes/${id}`)));
  const successes = responses.filter((response) => response.status === 200);
  const limited = responses.filter(
    (response) => response.status === 409 && response.json.error === 'LIMIT_REACHED',
  );

  assert.equal(successes.length, 5, '并发下只能成功 5 票');
  assert.equal(limited.length, 1, '第 6 个请求应该返回 409');
  assert.equal(server.store.getTotals().totalVotes, 5);

  const state = await client.get('/api/state');
  assert.equal(state.json.myVotes.length, 5);
  assert.equal(new Set(state.json.myVotes).size, 5, '不能有重复图标');
});

test('不同用户投同一图标各自计票，票数与参与人数正确', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const first = createClient(server.base);
  const second = createClient(server.base);
  await first.login('用户甲');
  await second.login('用户乙');

  await first.put('/api/votes/01');
  await first.put('/api/votes/02');
  await second.put('/api/votes/01');

  const state = await first.get('/api/state');
  assert.equal(state.json.totalVotes, 3);
  assert.equal(state.json.votersCount, 2);
  assert.equal(JSON.stringify(state.json).includes('用户乙'), false, '前台响应不得包含其他投票人姓名');
  assert.equal('voters' in state.json, false);
  const icon01 = state.json.icons.find((icon) => icon.id === '01');
  assert.equal(icon01.count, 2);
  assert.equal(icon01.rank, 1);
  const icon02 = state.json.icons.find((icon) => icon.id === '02');
  assert.equal(icon02.count, 1);
  assert.equal(icon02.rank, 2);
  assert.equal(state.json.icons.filter((icon) => icon.count === 0).every((icon) => icon.rank === 3), true);
});

test('关闭投票冻结新增与取消，重新开启后恢复', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const user = createClient(server.base);
  const admin = createClient(server.base);
  await user.login('冻结测试');
  await admin.loginAdmin();
  await user.put('/api/votes/01');

  const close = await admin.put('/api/admin/settings', { votingOpen: false });
  assert.equal(close.status, 200);
  assert.equal(close.json.votingOpen, false);

  let response = await user.put('/api/votes/02');
  assert.equal(response.status, 403);
  assert.equal(response.json.error, 'VOTING_CLOSED');

  response = await user.del('/api/votes/01');
  assert.equal(response.status, 403);
  assert.equal(response.json.error, 'VOTING_CLOSED');

  let state = await user.get('/api/state');
  assert.equal(state.json.votingOpen, false);
  assert.equal(state.json.totalVotes, 1);
  assert.deepEqual(state.json.myVotes, ['01']);

  const reopen = await admin.put('/api/admin/settings', { votingOpen: true });
  assert.equal(reopen.json.votingOpen, true);
  response = await user.put('/api/votes/02');
  assert.equal(response.status, 200);
  assert.equal(response.json.totalVotes, 2);
});

test('会话被篡改后投票返回 401，不写入数据库', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = createClient(server.base);
  await client.login('篡改测试');
  const token = client.cookies.get('toupiao_session');
  client.setCookie('toupiao_session', `${token.slice(0, -1)}x`);

  const response = await client.put('/api/votes/01');
  assert.equal(response.status, 401);
  assert.equal(server.store.getTotals().totalVotes, 0);
});

test('投票响应结构：包含 myVotes/icons/totalVotes/votersCount', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = createClient(server.base);
  await client.login('结构测试');
  const response = await client.put('/api/votes/01');
  assert.equal(response.status, 200);
  assert.deepEqual(response.json.myVotes, ['01']);
  assert.equal(response.json.totalVotes, 1);
  assert.equal(response.json.votersCount, 1);
  assert.equal(response.json.votingOpen, true);
  assert.equal(response.json.maxVotes, 5);
  assert.equal(response.json.icons.length, 6);
  assert.equal(response.json.icons[0].count, 1);
  assert.equal(response.json.icons[0].rank, 1);
});

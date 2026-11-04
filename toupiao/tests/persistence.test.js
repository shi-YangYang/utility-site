import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient, startServer } from './helpers.js';

test('B6 重启服务后投票、用户与会话仍在，投票关闭状态也保留', async (t) => {
  const first = await startServer({ keepDir: true });
  const client = createClient(first.base);
  const admin = createClient(first.base);
  await client.login('重启用户');
  await client.put('/api/votes/01');
  await client.put('/api/votes/02');
  await admin.loginAdmin();
  await admin.put('/api/admin/settings', { votingOpen: false });

  const dir = first.dir;
  await first.close();

  const second = await startServer({ dir, skipIcons: true });
  t.after(() => second.close());

  const clientAfterRestart = createClient(second.base);
  for (const [name, value] of client.cookies) clientAfterRestart.setCookie(name, value);
  const state = await clientAfterRestart.get('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.json.user.nick, '重启用户', '会话 cookie 在重启后仍然有效');
  assert.deepEqual(state.json.myVotes.sort(), ['01', '02']);
  assert.equal(state.json.totalVotes, 2);
  assert.equal(state.json.votersCount, 1);
  assert.equal(state.json.votingOpen, false);
  assert.equal(state.json.icons.length, 6);

  const adminAfterRestart = createClient(second.base);
  await adminAfterRestart.loginAdmin();
  const adminState = await adminAfterRestart.get('/api/admin/state');
  assert.equal(adminState.json.totalVotes, 2);
  assert.equal(adminState.json.votersCount, 1);
  assert.equal(adminState.json.userCount, 1);
  assert.equal(adminState.json.votingOpen, false);
  assert.equal(adminState.json.recentVotes.length, 2);
});

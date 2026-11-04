import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSecret, DINGTALK_SETTING_KEYS } from '../server/dingtalk-config.js';
import { createClient, startServer } from './helpers.js';

const ENV_DINGTALK = {
  PUBLIC_BASE_URL: 'https://env.example.com',
  DINGTALK_APP_KEY: 'env-app-key',
  DINGTALK_APP_SECRET: 'env-app-secret',
  DINGTALK_CORP_ID: 'env-corp',
};

test('管理接口鉴权：未登录 401、员工会话 403、错误口令 401、正确口令成功', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const anonymous = createClient(server.base, server);
  let response = await anonymous.get('/api/admin/state');
  assert.equal(response.status, 401);
  assert.equal(response.json.error, 'ADMIN_AUTH_REQUIRED');

  response = await anonymous.get('/api/admin/dingtalk');
  assert.equal(response.status, 401);
  assert.equal(response.json.error, 'ADMIN_AUTH_REQUIRED');

  const employee = createClient(server.base, server);
  await employee.loginAs('普通员工');
  response = await employee.get('/api/admin/state');
  assert.equal(response.status, 403);
  assert.equal(response.json.error, 'ADMIN_REQUIRED');
  response = await employee.get('/api/admin/dingtalk');
  assert.equal(response.status, 403);
  response = await employee.put('/api/admin/dingtalk', {});
  assert.equal(response.status, 403);

  const client = createClient(server.base, server);
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
  assert.equal('authMode' in login.json, false);
  assert.match(login.setCookies.join('\n'), /toupiao_admin=/);
  assert.match(login.setCookies.join('\n'), /HttpOnly/);
  assert.match(login.setCookies.join('\n'), /SameSite=Lax/);
  assert.match(login.setCookies.join('\n'), /Max-Age=604800/);

  response = await client.get('/api/admin/state');
  assert.equal(response.status, 200);
  assert.equal(response.json.votingOpen, true);
  assert.equal(response.json.totalVotes, 0);
  assert.equal(response.json.maxVotes, 5);
  assert.equal(response.json.dingtalkConfigured, false);
  assert.equal(response.json.publicBaseUrl, '');
  assert.equal('authMode' in response.json, false);

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
  const client = createClient(server.base, server);

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
  const fresh = createClient(otherServer.base, otherServer);
  const success = await fresh.loginAdmin();
  assert.equal(success.status, 200);
});

test('后台总览与投票人明细：统计、排名、占比、隐私边界', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const first = createClient(server.base, server);
  const second = createClient(server.base, server);
  const admin = createClient(server.base, server);
  await first.loginAs('用户甲');
  await second.loginAs('用户乙');
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
  assert.equal(state.json.dingtalkConfigured, false);
  assert.equal(state.json.publicBaseUrl, '');
  assert.equal('authMode' in state.json, false);

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
  const admin = createClient(server.base, server);
  const publicClient = createClient(server.base, server);
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
  const first = createClient(server.base, server);
  const second = createClient(server.base, server);
  const admin = createClient(server.base, server);
  await first.loginAs('重置甲');
  await second.loginAs('重置乙');
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

  const employee = createClient(server.base, server);
  await employee.loginAs('无权限');
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

  const admin = createClient(server.base, server);
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

test('钉钉配置 GET/PUT：校验、保存立即生效、secret 不回显也不落明文', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const admin = createClient(server.base, server);
  const publicClient = createClient(server.base, server);
  await admin.loginAdmin();

  let response = await admin.get('/api/admin/dingtalk');
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    configured: false,
    appKey: '',
    corpId: '',
    publicBaseUrl: '',
    callbackUrl: '',
    hasSecret: false,
    source: 'none',
  });

  response = await admin.put('/api/admin/dingtalk', {});
  assert.equal(response.status, 400);
  assert.equal(response.json.error, 'SECRET_REQUIRED');

  const invalidPayloads = [
    { appKey: 'k', appSecret: 's', publicBaseUrl: 'https://vote.example.com/path' },
    { appKey: 'k', appSecret: 's', publicBaseUrl: 'https://vote.example.com?x=1' },
    { appKey: 'k', appSecret: 's', publicBaseUrl: 'ftp://vote.example.com' },
    { appKey: 'k'.repeat(129), appSecret: 's', publicBaseUrl: 'https://vote.example.com' },
    { appKey: 'k', appSecret: 's'.repeat(257), publicBaseUrl: 'https://vote.example.com' },
    { appKey: 'k', appSecret: 'line\nbreak', publicBaseUrl: 'https://vote.example.com' },
    { appKey: 'k', appSecret: 's', corpId: 'c'.repeat(129), publicBaseUrl: 'https://vote.example.com' },
  ];
  for (const payload of invalidPayloads) {
    response = await admin.put('/api/admin/dingtalk', payload);
    assert.equal(response.status, 400, JSON.stringify({ ...payload, appSecret: '[redacted]' }));
    assert.equal(response.json.error, 'INVALID_DINGTALK_CONFIG');
    assert.equal(typeof response.json.message, 'string');
    assert.equal(response.text.includes('line\\nbreak'), false);
  }

  response = await admin.put(
    '/api/admin/dingtalk',
    {
      appKey: 'db-app-key',
      appSecret: 'db-app-secret',
      corpId: 'db-corp',
      publicBaseUrl: 'https://vote.example.com/',
    },
    { headers: { origin: 'https://evil.example' } },
  );
  assert.equal(response.status, 403);
  assert.equal(response.json.error, 'ORIGIN_FORBIDDEN');

  response = await admin.put('/api/admin/dingtalk', {
    appKey: 'db-app-key',
    appSecret: 'db-app-secret',
    corpId: 'db-corp',
    publicBaseUrl: 'https://vote.example.com/',
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.configured, true);
  assert.equal(response.json.appKey, 'db-app-key');
  assert.equal(response.json.corpId, 'db-corp');
  assert.equal(response.json.publicBaseUrl, 'https://vote.example.com');
  assert.equal(response.json.callbackUrl, 'https://vote.example.com/api/auth/callback');
  assert.equal(response.json.hasSecret, true);
  assert.equal(response.json.source, 'db');
  assert.equal(response.text.includes('db-app-secret'), false, 'PUT 响应不能包含 AppSecret');

  const getResponse = await admin.get('/api/admin/dingtalk');
  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.text.includes('db-app-secret'), false, 'GET 响应不能包含 AppSecret');
  assert.equal(getResponse.json.hasSecret, true);

  const encrypted = server.store.getSetting(DINGTALK_SETTING_KEYS.appSecretEnc);
  assert.match(encrypted, /^v1:[A-Za-z0-9_-]+$/);
  assert.equal(encrypted.includes('db-app-secret'), false, '数据库不能出现明文 AppSecret');
  assert.equal(decryptSecret(encrypted, server.config.sessionSecret), 'db-app-secret');

  const logText = JSON.stringify(server.logger.entries);
  assert.equal(logText.includes('db-app-secret'), false, '日志不能包含 AppSecret');
  assert.match(logText, /登录配置已更新/);

  const state = await publicClient.get('/api/state');
  assert.equal(state.json.loginConfigured, true);
  assert.equal(JSON.stringify(state.json).includes('db-app-secret'), false);
  const adminState = await admin.get('/api/admin/state');
  assert.equal(adminState.json.dingtalkConfigured, true);
  assert.equal(adminState.json.publicBaseUrl, 'https://vote.example.com');
  assert.equal(JSON.stringify(adminState.json).includes('db-app-secret'), false);

  const login = await publicClient.get('/api/auth/login?next=/');
  assert.equal(login.status, 302);
  const authorizeUrl = new URL(login.headers.get('location'));
  assert.equal(authorizeUrl.searchParams.get('client_id'), 'db-app-key');
  assert.equal(
    authorizeUrl.searchParams.get('redirect_uri'),
    'https://vote.example.com/api/auth/callback',
  );

  const kept = await admin.put('/api/admin/dingtalk', {
    appKey: 'db-app-key-2',
    corpId: 'db-corp-2',
    publicBaseUrl: 'https://vote2.example.com',
  });
  assert.equal(kept.status, 200);
  assert.equal(kept.json.appKey, 'db-app-key-2');
  assert.equal(kept.json.hasSecret, true, '省略 AppSecret 应保留原密文');
  assert.equal(
    server.store.getSetting(DINGTALK_SETTING_KEYS.appSecretEnc),
    encrypted,
    '省略 AppSecret 不应改写密文',
  );

  const cleared = await admin.put('/api/admin/dingtalk', {
    appKey: '',
    corpId: '',
    publicBaseUrl: '',
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.configured, false);
  assert.equal(cleared.json.hasSecret, true);
  assert.equal(cleared.json.appKey, '');
  assert.equal(cleared.json.publicBaseUrl, '');
  const loginAfterClear = await publicClient.get('/api/auth/login');
  assert.equal(loginAfterClear.headers.get('location'), '/?auth_error=AUTH_NOT_CONFIGURED');
});

test('钉钉配置：DB > env、空值回退 env、换 SESSION_SECRET 后视为未配置', async (t) => {
  const server = await startServer({ env: ENV_DINGTALK });
  t.after(() => server.close());
  const admin = createClient(server.base, server);
  await admin.loginAdmin();

  let response = await admin.get('/api/admin/dingtalk');
  assert.equal(response.json.configured, true);
  assert.equal(response.json.appKey, 'env-app-key');
  assert.equal(response.json.corpId, 'env-corp');
  assert.equal(response.json.publicBaseUrl, 'https://env.example.com');
  assert.equal(response.json.source, 'env');
  assert.equal(response.json.hasSecret, true);

  response = await admin.put('/api/admin/dingtalk', {
    appKey: 'db-app-key',
    appSecret: 'db-app-secret',
    corpId: 'db-corp',
    publicBaseUrl: 'https://db.example.com',
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.appKey, 'db-app-key');
  assert.equal(response.json.source, 'db');

  response = await admin.put('/api/admin/dingtalk', {
    appKey: '',
    corpId: '',
    publicBaseUrl: '',
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.appKey, 'env-app-key', '空值应回退到环境变量');
  assert.equal(response.json.corpId, 'env-corp');
  assert.equal(response.json.publicBaseUrl, 'https://env.example.com');
  assert.equal(response.json.source, 'mixed', 'secret 仍在 DB，其余回退 env');
  assert.equal(response.json.hasSecret, true);

  server.store.deleteSetting(DINGTALK_SETTING_KEYS.appSecretEnc);
  response = await admin.get('/api/admin/dingtalk');
  assert.equal(response.json.source, 'env');
  assert.equal(response.json.hasSecret, true, 'env 的 AppSecret 仍可作为引导值');

  const first = await startServer({ keepDir: true, env: ENV_DINGTALK });
  const firstAdmin = createClient(first.base, first);
  await firstAdmin.loginAdmin();
  const saved = await firstAdmin.put('/api/admin/dingtalk', {
    appKey: 'persisted-key',
    appSecret: 'persisted-secret',
    corpId: 'persisted-corp',
    publicBaseUrl: 'https://persisted.example.com',
  });
  assert.equal(saved.status, 200);
  const dir = first.dir;
  await first.close();

  const second = await startServer({
    dir,
    skipIcons: true,
    env: {
      ...ENV_DINGTALK,
      SESSION_SECRET: 'another-session-secret-0123456789abcdef-xyz',
    },
  });
  t.after(() => second.close());
  const secondAdmin = createClient(second.base, second);
  await secondAdmin.loginAdmin();
  response = await secondAdmin.get('/api/admin/dingtalk');
  assert.equal(response.status, 200);
  assert.equal(response.json.configured, false, '换 SESSION_SECRET 后 AppSecret 无法解密');
  assert.equal(response.json.hasSecret, false);
  assert.equal(response.json.appKey, 'persisted-key');
  assert.equal(response.json.publicBaseUrl, 'https://persisted.example.com');
  assert.match(
    JSON.stringify(second.logger.entries),
    /无法解密/,
    '解密失败应打印一次警告',
  );

  const publicClient = createClient(second.base, second);
  const login = await publicClient.get('/api/auth/login');
  assert.equal(login.headers.get('location'), '/?auth_error=AUTH_NOT_CONFIGURED');

  const recovered = await secondAdmin.put('/api/admin/dingtalk', {
    appKey: 'persisted-key',
    appSecret: 'new-secret',
    corpId: 'persisted-corp',
    publicBaseUrl: 'https://persisted.example.com',
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.json.configured, true);
  assert.equal(recovered.json.hasSecret, true);
  const loginRecovered = await publicClient.get('/api/auth/login');
  assert.equal(loginRecovered.status, 302);
});

test('钉钉配置并发保存：后写覆盖、返回最终状态、响应不泄露 secret', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const admin = createClient(server.base, server);
  await admin.loginAdmin();

  const payloads = [
    {
      appKey: 'concurrent-a',
      appSecret: 'concurrent-secret-a',
      publicBaseUrl: 'https://a.example.com',
    },
    {
      appKey: 'concurrent-b',
      appSecret: 'concurrent-secret-b',
      publicBaseUrl: 'https://b.example.com',
    },
    {
      appKey: 'concurrent-c',
      appSecret: 'concurrent-secret-c',
      publicBaseUrl: 'https://c.example.com',
    },
  ];
  const responses = await Promise.all(
    payloads.map((payload) => admin.put('/api/admin/dingtalk', payload)),
  );
  for (const [index, response] of responses.entries()) {
    assert.equal(response.status, 200);
    assert.equal(response.json.configured, true);
    assert.equal(response.json.hasSecret, true);
    assert.equal(
      response.text.includes(payloads[index].appSecret),
      false,
      '并发保存的响应也不能包含 AppSecret',
    );
  }

  const final = await admin.get('/api/admin/dingtalk');
  assert.equal(final.status, 200);
  assert.equal(final.json.configured, true);
  assert.equal(final.json.hasSecret, true);
  assert.ok(
    payloads.some((payload) => payload.appKey === final.json.appKey),
    '最终状态应是某一次保存的结果',
  );
  assert.equal(final.json.publicBaseUrl, `https://${final.json.appKey.slice(-1)}.example.com`);
  assert.equal(
    payloads.some((payload) => final.text.includes(payload.appSecret)),
    false,
    '最终 GET 响应不能包含 AppSecret',
  );
});

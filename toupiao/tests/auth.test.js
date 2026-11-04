import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigError, loadConfig } from '../server/config.js';
import { createToken } from '../server/http.js';
import { createClient, startServer } from './helpers.js';

const DINGTALK_ENV = {
  AUTH_MODE: 'dingtalk',
  PUBLIC_BASE_URL: 'https://vote.example.com',
  DINGTALK_APP_KEY: 'ding-app-key',
  DINGTALK_APP_SECRET: 'ding-app-secret',
  DINGTALK_CORP_ID: 'corp-123',
  TRUST_PROXY: '1',
};

function tokenFromStateCookie(response) {
  const cookie = response.setCookies.find((item) => item.startsWith('toupiao_oauth_state='));
  return cookie ? cookie.split(';')[0].split('=').slice(1).join('=') : null;
}

test('mock 登录：姓名 trim、稳定身份、cookie 属性与登出', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = createClient(server.base);

  const login = await client.post('/api/auth/mock', { name: '  张三  ' });
  assert.equal(login.status, 200);
  assert.equal(login.json.ok, true);
  assert.equal(login.json.authMode, 'mock');
  assert.equal(login.json.user.nick, '张三');

  const setCookie = login.setCookies.join('\n');
  assert.match(setCookie, /toupiao_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=604800/);
  assert.doesNotMatch(setCookie, /Secure/);

  const state = await client.get('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.json.user.nick, '张三');
  assert.deepEqual(state.json.myVotes, []);
  assert.equal(state.json.maxVotes, 5);
  assert.equal(state.json.authMode, 'mock');
  assert.equal(state.json.iconsAvailable, true);
  assert.equal(state.json.icons.length, 6);
  assert.equal(state.json.totalVotes, 0);
  assert.equal(
    state.json.icons.every((icon) => icon.count === 0 && icon.rank === 1),
    true,
    '空数据库时所有图标票数为 0、排名并列第 1',
  );

  const otherClient = createClient(server.base);
  await otherClient.post('/api/auth/mock', { name: '张三' });
  assert.equal(server.store.getTotals().userCount, 1, '同名 mock 登录不应产生新用户');

  const logout = await client.post('/api/auth/logout');
  assert.equal(logout.status, 200);
  assert.match(logout.setCookies.join('\n'), /Max-Age=0/);
  const after = await client.get('/api/state');
  assert.equal(after.json.user, null);
});

test('mock 姓名校验：空、超长、非字符串、控制字符均 400', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = createClient(server.base);

  for (const name of ['', '   ', 'a'.repeat(21), 123, null, '张三\n李四']) {
    const response = await client.post('/api/auth/mock', { name });
    assert.equal(response.status, 400, `name=${JSON.stringify(name)} 应该被拒绝`);
    assert.equal(response.json.error, 'INVALID_NAME');
  }

  const twenty = '一'.repeat(20);
  const ok = await client.post('/api/auth/mock', { name: twenty });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.nick, twenty);
});

test('会话篡改、错误签名、过期 token 均视为未登录且不 500', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = createClient(server.base);
  await client.login('李四');

  const original = client.cookies.get('toupiao_session');
  assert.ok(original);
  const tampered = `${original.slice(0, -2)}${original.endsWith('aa') ? 'bb' : 'aa'}`;
  client.setCookie('toupiao_session', tampered);
  let response = await client.get('/api/state');
  assert.equal(response.status, 200);
  assert.equal(response.json.user, null);

  const expired = createToken(
    { kind: 'user', uid: 1 },
    server.config.sessionSecret,
    { ttlSeconds: -10 },
  );
  client.setCookie('toupiao_session', expired);
  response = await client.get('/api/state');
  assert.equal(response.status, 200);
  assert.equal(response.json.user, null);

  const forged = createToken(
    { kind: 'user', uid: 1 },
    'a-different-secret-that-is-long-enough-0123456789',
    { ttlSeconds: 600 },
  );
  client.setCookie('toupiao_session', forged);
  response = await client.get('/api/state');
  assert.equal(response.status, 200);
  assert.equal(response.json.user, null);
});

test('Secure cookie：COOKIE_SECURE=true 与反代 https 两种情况', async (t) => {
  const forced = await startServer({ env: { COOKIE_SECURE: 'true' } });
  t.after(() => forced.close());
  const forcedClient = createClient(forced.base);
  const forcedLogin = await forcedClient.post('/api/auth/mock', { name: '安全用户' });
  assert.match(forcedLogin.setCookies.join('\n'), /Secure/);

  const proxied = await startServer({ env: { COOKIE_SECURE: 'auto', TRUST_PROXY: '1' } });
  t.after(() => proxied.close());
  const proxiedClient = createClient(proxied.base);
  const proxiedLogin = await proxiedClient.post(
    '/api/auth/mock',
    { name: '反代用户' },
    { headers: { 'x-forwarded-proto': 'https' } },
  );
  assert.match(proxiedLogin.setCookies.join('\n'), /Secure/);

  const insecure = await startServer({ env: { COOKIE_SECURE: 'false' } });
  t.after(() => insecure.close());
  const insecureClient = createClient(insecure.base);
  const insecureLogin = await insecureClient.post(
    '/api/auth/mock',
    { name: '直连用户' },
    { headers: { 'x-forwarded-proto': 'https' } },
  );
  assert.doesNotMatch(insecureLogin.setCookies.join('\n'), /Secure/);
});

test('mock 模式下 /api/auth/login 返回 400，钉钉模式下 mock 接口 404', async (t) => {
  const mockServer = await startServer();
  t.after(() => mockServer.close());
  const mockClient = createClient(mockServer.base);
  const login = await mockClient.get('/api/auth/login');
  assert.equal(login.status, 400);
  assert.equal(login.json.error, 'MOCK_MODE');

  const dingServer = await startServer({ env: DINGTALK_ENV });
  t.after(() => dingServer.close());
  const dingClient = createClient(dingServer.base);
  const mockLogin = await dingClient.post('/api/auth/mock', { name: '张三' });
  assert.equal(mockLogin.status, 404);
  const callback = await dingClient.get('/api/auth/callback?code=x&state=y');
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/?auth_error=STATE_INVALID');
});

test('钉钉授权跳转参数正确（含 state cookie 和 corpId）', async (t) => {
  const server = await startServer({ env: DINGTALK_ENV });
  t.after(() => server.close());
  const client = createClient(server.base);

  const response = await client.get('/api/auth/login?next=/admin');
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin, 'https://login.dingtalk.com');
  assert.equal(location.pathname, '/oauth2/auth');
  const params = location.searchParams;
  assert.equal(params.get('redirect_uri'), 'https://vote.example.com/api/auth/callback');
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('client_id'), 'ding-app-key');
  assert.equal(params.get('scope'), 'openid');
  assert.equal(params.get('prompt'), 'consent');
  assert.equal(params.get('corpId'), 'corp-123');
  assert.ok((params.get('state') ?? '').length >= 20);

  const stateCookie = tokenFromStateCookie(response);
  assert.ok(stateCookie, '应写入 oauth state cookie');
  assert.match(response.setCookies.join('\n'), /HttpOnly/);
  assert.match(response.setCookies.join('\n'), /SameSite=Lax/);
  assert.match(response.setCookies.join('\n'), /Secure/);
});

test('钉钉授权 URL 未配置 corpId 时不带 corpId', async (t) => {
  const server = await startServer({
    env: { ...DINGTALK_ENV, DINGTALK_CORP_ID: '' },
  });
  t.after(() => server.close());
  const client = createClient(server.base);
  const response = await client.get('/api/auth/login');
  const location = new URL(response.headers.get('location'));
  assert.equal(location.searchParams.has('corpId'), false);
});

test('钉钉回调：state 不匹配不建立会话，错误参数可读', async (t) => {
  let fetchCalls = 0;
  const server = await startServer({
    env: DINGTALK_ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('不应调用钉钉');
    },
  });
  t.after(() => server.close());
  const client = createClient(server.base);

  const login = await client.get('/api/auth/login?next=/');
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  const callback = await client.get(
    `/api/auth/callback?code=good-code&state=${encodeURIComponent(`${state}tampered`)}`,
  );
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/?auth_error=STATE_INVALID');
  assert.equal(fetchCalls, 0);

  const stateAfter = await client.get('/api/state');
  assert.equal(stateAfter.json.user, null);

  const deniedClient = createClient(server.base);
  const deniedLogin = await deniedClient.get('/api/auth/login');
  const deniedState = new URL(deniedLogin.headers.get('location')).searchParams.get('state');
  const denied = await deniedClient.get(
    `/api/auth/callback?error=access_denied&state=${encodeURIComponent(deniedState)}`,
  );
  assert.equal(denied.headers.get('location'), '/?auth_error=DENIED');

  const missingCodeClient = createClient(server.base);
  const missingLogin = await missingCodeClient.get('/api/auth/login');
  const missingState = new URL(missingLogin.headers.get('location')).searchParams.get('state');
  const missing = await missingCodeClient.get(
    `/api/auth/callback?state=${encodeURIComponent(missingState)}`,
  );
  assert.equal(missing.headers.get('location'), '/?auth_error=CODE_MISSING');
});

test('钉钉回调成功：换 token、取用户、建会话并回到 next', async (t) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/v1.0/oauth2/userAccessToken')) {
      return new Response(JSON.stringify({ accessToken: 'token-abc', expireIn: 7200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/v1.0/contact/users/me')) {
      return new Response(
        JSON.stringify({
          unionId: 'union-42',
          nick: '钉钉小王',
          avatarUrl: 'https://static.dingtalk.com/avatar.png',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`unexpected url ${url}`);
  };
  const server = await startServer({ env: DINGTALK_ENV, fetchImpl });
  t.after(() => server.close());
  const client = createClient(server.base);

  const login = await client.get('/api/auth/login?next=/admin');
  const state = new URL(login.headers.get('location')).searchParams.get('state');
  const callback = await client.get(
    `/api/auth/callback?code=good-code&state=${encodeURIComponent(state)}`,
  );
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/admin');
  assert.match(callback.setCookies.join('\n'), /toupiao_session=/);

  assert.equal(calls.length, 2);
  const tokenCall = calls.find((call) => call.url.includes('userAccessToken'));
  const body = JSON.parse(tokenCall.init.body);
  assert.equal(body.clientId, 'ding-app-key');
  assert.equal(body.clientSecret, 'ding-app-secret');
  assert.equal(body.code, 'good-code');
  assert.equal(body.grantType, 'authorization_code');

  const meCall = calls.find((call) => call.url.includes('/contact/users/me'));
  assert.equal(meCall.init.headers['x-acs-dingtalk-access-token'], 'token-abc');

  const stateResponse = await client.get('/api/state');
  assert.equal(stateResponse.json.user.nick, '钉钉小王');
  assert.equal(stateResponse.json.user.avatarUrl, 'https://static.dingtalk.com/avatar.png');
  assert.equal(server.store.getTotals().userCount, 1);

  const again = createClient(server.base);
  const loginAgain = await again.get('/api/auth/login');
  const stateAgain = new URL(loginAgain.headers.get('location')).searchParams.get('state');
  await again.get(`/api/auth/callback?code=second&state=${encodeURIComponent(stateAgain)}`);
  assert.equal(server.store.getTotals().userCount, 1, 'unionId 应 upsert 而非新增');
});

test('登录 next 参数防开放重定向（集成）', async (t) => {
  const fetchImpl = async (url) => {
    if (String(url).includes('userAccessToken')) {
      return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 });
    }
    return new Response(JSON.stringify({ unionId: 'u-redirect', nick: '重定向测试' }), {
      status: 200,
    });
  };
  const server = await startServer({ env: DINGTALK_ENV, fetchImpl });
  t.after(() => server.close());

  const cases = [
    ['https://evil.example/steal', '/'],
    ['//evil.example/steal', '/'],
    ['/\\evil.example/steal', '/'],
    ['/%2f%2fevil.example/steal', '/'],
    ['/%5cevil.example/steal', '/'],
    ['/admin', '/admin'],
  ];

  for (const [next, expected] of cases) {
    const client = createClient(server.base);
    const login = await client.get(`/api/auth/login?next=${encodeURIComponent(next)}`);
    const state = new URL(login.headers.get('location')).searchParams.get('state');
    const callback = await client.get(
      `/api/auth/callback?code=code-1&state=${encodeURIComponent(state)}`,
    );
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), expected, `next=${next}`);
  }
});

test('配置校验：缺配置、短口令、示例值、dingtalk 缺凭据都启动失败', () => {
  const valid = {
    AUTH_MODE: 'mock',
    ADMIN_PASSWORD: 'test-admin-123',
    SESSION_SECRET: 'x'.repeat(40),
  };

  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ ...valid, AUTH_MODE: '' }), ConfigError);
  assert.throws(() => loadConfig({ ...valid, AUTH_MODE: 'oauth' }), ConfigError);
  assert.throws(() => loadConfig({ ...valid, ADMIN_PASSWORD: 'short' }), ConfigError);
  assert.throws(() => loadConfig({ ...valid, ADMIN_PASSWORD: 'change-me-now' }), ConfigError);
  assert.throws(() => loadConfig({ ...valid, SESSION_SECRET: 'too-short' }), ConfigError);
  assert.throws(
    () => loadConfig({ ...valid, SESSION_SECRET: 'replace-with-at-least-32-random-characters' }),
    ConfigError,
  );
  assert.throws(
    () => loadConfig({ ...valid, AUTH_MODE: 'dingtalk' }),
    ConfigError,
    'dingtalk 缺 PUBLIC_BASE_URL / AppKey / AppSecret 必须失败',
  );
  assert.throws(
    () =>
      loadConfig({
        ...valid,
        AUTH_MODE: 'dingtalk',
        PUBLIC_BASE_URL: 'https://vote.example.com',
        DINGTALK_APP_KEY: 'key',
      }),
    ConfigError,
  );
  assert.throws(
    () => loadConfig({ ...valid, PUBLIC_BASE_URL: 'https://vote.example.com/path' }),
    ConfigError,
  );
  assert.throws(() => loadConfig({ ...valid, COOKIE_SECURE: 'maybe' }), ConfigError);

  const config = loadConfig(valid);
  assert.equal(config.authMode, 'mock');
  assert.equal(config.publicBaseUrl, 'http://localhost:3001');
  assert.equal(config.maxVotes, 5);
  assert.equal(config.sessionMaxAgeSeconds, 7 * 24 * 60 * 60);
});

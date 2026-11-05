import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigError, loadConfig } from '../server/config.js';
import { createToken } from '../server/http.js';
import { createClient, startServer } from './helpers.js';

const BASE_ENV = {
  ADMIN_PASSWORD: 'test-admin-123',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef-xyz',
};

const DINGTALK_ENV = {
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

test('配置校验：钉钉凭据可选，AUTH_MODE 被忽略，测试基址仅 test 生效', () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ ...BASE_ENV, ADMIN_PASSWORD: '' }), ConfigError);
  assert.throws(() => loadConfig({ ...BASE_ENV, ADMIN_PASSWORD: 'short' }), ConfigError);
  assert.throws(() => loadConfig({ ...BASE_ENV, ADMIN_PASSWORD: 'change-me-now' }), ConfigError);
  assert.throws(() => loadConfig({ ...BASE_ENV, SESSION_SECRET: 'too-short' }), ConfigError);
  assert.throws(
    () => loadConfig({ ...BASE_ENV, SESSION_SECRET: 'replace-with-at-least-32-random-characters' }),
    ConfigError,
  );
  assert.throws(
    () => loadConfig({ ...BASE_ENV, PUBLIC_BASE_URL: 'https://vote.example.com/path' }),
    ConfigError,
  );
  assert.throws(
    () =>
      loadConfig({
        ...BASE_ENV,
        NODE_ENV: 'production',
        PUBLIC_BASE_URL: 'http://vote.example.com',
      }),
    ConfigError,
  );
  assert.throws(() => loadConfig({ ...BASE_ENV, COOKIE_SECURE: 'maybe' }), ConfigError);
  assert.throws(
    () => loadConfig({ ...BASE_ENV, NODE_ENV: 'test', DINGTALK_TEST_BASE: 'not-a-url' }),
    ConfigError,
  );

  const config = loadConfig({
    ...BASE_ENV,
    AUTH_MODE: 'mock',
    NODE_ENV: 'development',
  });
  assert.equal(config.authMode, undefined, '不再有 authMode 配置');
  assert.equal(config.isMock, undefined, '不再有 isMock 配置');
  assert.equal(config.publicBaseUrl, 'http://localhost:3001');
  assert.equal(config.envPublicBaseUrl, '');
  assert.deepEqual(config.dingtalk, { appKey: '', appSecret: '', corpId: '' });
  assert.equal(config.dingtalkTestBase, '');
  assert.equal(config.maxVotes, 5);
  assert.equal(config.sessionMaxAgeSeconds, 7 * 24 * 60 * 60);

  const localProduction = loadConfig({
    ...BASE_ENV,
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'http://127.0.0.1:3001',
  });
  assert.equal(localProduction.publicBaseUrl, 'http://127.0.0.1:3001');

  const testConfig = loadConfig({
    ...BASE_ENV,
    NODE_ENV: 'test',
    DINGTALK_TEST_BASE: 'http://127.0.0.1:9999',
  });
  assert.equal(testConfig.dingtalkTestBase, 'http://127.0.0.1:9999');

  const productionConfig = loadConfig({
    ...BASE_ENV,
    NODE_ENV: 'production',
    DINGTALK_TEST_BASE: 'http://127.0.0.1:9999',
  });
  assert.equal(productionConfig.dingtalkTestBase, '', '生产环境必须忽略测试基址');
});

test('未配置钉钉：state loginConfigured=false，登录 302 提示，mock 路由 404', async (t) => {
  const server = await startServer({ env: { AUTH_MODE: 'mock' } });
  t.after(() => server.close());
  const client = createClient(server.base, server);

  const state = await client.get('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.json.loginConfigured, false);
  assert.equal('authMode' in state.json, false);

  const login = await client.get('/api/auth/login?next=/admin');
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/?auth_error=AUTH_NOT_CONFIGURED');
  assert.equal(tokenFromStateCookie(login), null, '未配置时不应写入 state cookie');

  const callback = await client.get('/api/auth/callback?code=x&state=y');
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/?auth_error=AUTH_NOT_CONFIGURED');

  const mock = await client.post('/api/auth/mock', { name: '张三' });
  assert.equal(mock.status, 404);
  assert.equal(mock.json.error, 'NOT_FOUND');
  assert.equal(server.store.getTotals().userCount, 0);

  const legacyMockEnv = await startServer({ env: { AUTH_MODE: 'mock' } });
  t.after(() => legacyMockEnv.close());
  const legacyLogin = await createClient(legacyMockEnv.base, legacyMockEnv).get('/api/auth/login');
  assert.equal(
    legacyLogin.headers.get('location'),
    '/?auth_error=AUTH_NOT_CONFIGURED',
    '旧 .env 的 AUTH_MODE 不再生效',
  );
});

test('钉钉授权跳转参数正确（含 state cookie 和 corpId）', async (t) => {
  const server = await startServer({ env: DINGTALK_ENV });
  t.after(() => server.close());
  const client = createClient(server.base, server);

  const stateResponse = await client.get('/api/state');
  assert.equal(stateResponse.json.loginConfigured, true);

  const response = await client.get('/api/auth/login?next=/admin');
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin, 'https://login.dingtalk.com');
  assert.equal(location.pathname, '/oauth2/auth');
  const params = location.searchParams;
  assert.equal(params.get('redirect_uri'), 'https://vote.example.com/api/auth/callback');
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('client_id'), 'ding-app-key');
  assert.equal(params.get('scope'), 'openid corpid');
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
  const client = createClient(server.base, server);
  const response = await client.get('/api/auth/login');
  const location = new URL(response.headers.get('location'));
  assert.equal(location.searchParams.has('corpId'), false);
  assert.equal(location.searchParams.get('scope'), 'openid');
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
  const client = createClient(server.base, server);

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

  const deniedClient = createClient(server.base, server);
  const deniedLogin = await deniedClient.get('/api/auth/login');
  const deniedState = new URL(deniedLogin.headers.get('location')).searchParams.get('state');
  const denied = await deniedClient.get(
    `/api/auth/callback?error=access_denied&state=${encodeURIComponent(deniedState)}`,
  );
  assert.equal(denied.headers.get('location'), '/?auth_error=DENIED');

  const missingCodeClient = createClient(server.base, server);
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
  const client = createClient(server.base, server);

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
  assert.equal(tokenCall.url, 'https://api.dingtalk.com/v1.0/oauth2/userAccessToken');
  const body = JSON.parse(tokenCall.init.body);
  assert.equal(body.clientId, 'ding-app-key');
  assert.equal(body.clientSecret, 'ding-app-secret');
  assert.equal(body.code, 'good-code');
  assert.equal(body.grantType, 'authorization_code');

  const meCall = calls.find((call) => call.url.includes('/contact/users/me'));
  assert.equal(meCall.url, 'https://api.dingtalk.com/v1.0/contact/users/me');
  assert.equal(meCall.init.headers['x-acs-dingtalk-access-token'], 'token-abc');

  const stateResponse = await client.get('/api/state');
  assert.equal(stateResponse.json.user.nick, '钉钉小王');
  assert.equal(stateResponse.json.user.avatarUrl, 'https://static.dingtalk.com/avatar.png');
  assert.equal(server.store.getTotals().userCount, 1);

  const again = createClient(server.base, server);
  const loginAgain = await again.get('/api/auth/login');
  const stateAgain = new URL(loginAgain.headers.get('location')).searchParams.get('state');
  await again.get(`/api/auth/callback?code=second&state=${encodeURIComponent(stateAgain)}`);
  assert.equal(server.store.getTotals().userCount, 1, 'unionId 应 upsert 而非新增');
});

test('DINGTALK_TEST_BASE 仅在 NODE_ENV=test 时覆盖钉钉 endpoint', async (t) => {
  const fakeBase = 'http://127.0.0.1:45678';
  const testServer = await startServer({
    env: { ...DINGTALK_ENV, NODE_ENV: 'test', DINGTALK_TEST_BASE: fakeBase },
  });
  t.after(() => testServer.close());
  const testLogin = await createClient(testServer.base, testServer).get('/api/auth/login');
  const testLocation = new URL(testLogin.headers.get('location'));
  assert.equal(testLocation.origin, fakeBase);
  assert.equal(testLocation.pathname, '/oauth2/auth');

  const productionServer = await startServer({
    env: { ...DINGTALK_ENV, NODE_ENV: 'production', DINGTALK_TEST_BASE: fakeBase },
  });
  t.after(() => productionServer.close());
  const productionLogin = await createClient(productionServer.base, productionServer).get(
    '/api/auth/login',
  );
  const productionLocation = new URL(productionLogin.headers.get('location'));
  assert.equal(productionLocation.origin, 'https://login.dingtalk.com');
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
    const client = createClient(server.base, server);
    const login = await client.get(`/api/auth/login?next=${encodeURIComponent(next)}`);
    const state = new URL(login.headers.get('location')).searchParams.get('state');
    const callback = await client.get(
      `/api/auth/callback?code=code-1&state=${encodeURIComponent(state)}`,
    );
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), expected, `next=${next}`);
  }
});

test('会话篡改、错误签名、过期 token 均视为未登录且不 500', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = createClient(server.base, server);
  await client.loginAs('李四');

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

test('会话 cookie：COOKIE_SECURE=true、反代 https 与强制 false', async (t) => {
  const forced = await startServer({ env: { COOKIE_SECURE: 'true' } });
  t.after(() => forced.close());
  const forcedLogin = await createClient(forced.base, forced).loginAdmin();
  assert.match(forcedLogin.setCookies.join('\n'), /Secure/);

  const proxied = await startServer({ env: { COOKIE_SECURE: 'auto', TRUST_PROXY: '1' } });
  t.after(() => proxied.close());
  const proxiedLogin = await createClient(proxied.base, proxied).post(
    '/api/admin/login',
    { password: 'test-admin-123' },
    { headers: { 'x-forwarded-proto': 'https' } },
  );
  assert.match(proxiedLogin.setCookies.join('\n'), /Secure/);

  const insecure = await startServer({ env: { COOKIE_SECURE: 'false' } });
  t.after(() => insecure.close());
  const insecureLogin = await createClient(insecure.base, insecure).post(
    '/api/admin/login',
    { password: 'test-admin-123' },
    { headers: { 'x-forwarded-proto': 'https' } },
  );
  assert.doesNotMatch(insecureLogin.setCookies.join('\n'), /Secure/);

  const httpsSite = await startServer({
    env: { COOKIE_SECURE: 'auto', PUBLIC_BASE_URL: 'https://vote.example.com' },
  });
  t.after(() => httpsSite.close());
  const httpsLogin = await createClient(httpsSite.base, httpsSite).loginAdmin();
  assert.match(httpsLogin.setCookies.join('\n'), /Secure/);
});

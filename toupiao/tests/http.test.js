import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createClient, startServer } from './helpers.js';

test('畸形 JSON 与超过 64KB 的请求体：400/413，服务不崩溃', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = createClient(server.base, server);

  let response = await client.request('/api/admin/login', {
    method: 'POST',
    rawBody: '{"password":',
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(response.status, 400);
  assert.equal(response.json.error, 'BAD_JSON');

  response = await client.request('/api/admin/login', {
    method: 'POST',
    rawBody: JSON.stringify({ password: 'x'.repeat(70 * 1024) }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(response.status, 413);
  assert.equal(response.json.error, 'PAYLOAD_TOO_LARGE');

  response = await client.post('/api/admin/login', [1, 2, 3]);
  assert.equal(response.status, 400);
  assert.equal(response.json.error, 'BAD_JSON');

  const health = await client.get('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(server.store.getTotals().userCount, 0, '错误请求不能写库');
});

test('Origin 校验：跨站写请求 403，同源/无 Origin/开发地址放行', async (t) => {
  const server = await startServer();
  t.after(() => server.close());

  const evil = createClient(server.base, server);
  let response = await evil.post('/api/auth/logout', undefined, {
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(response.status, 403);
  assert.equal(response.json.error, 'ORIGIN_FORBIDDEN');

  response = await createClient(server.base, server).post('/api/auth/logout', undefined, {
    headers: { origin: 'null' },
  });
  assert.equal(response.status, 403);

  response = await createClient(server.base, server).post('/api/auth/logout', undefined, {
    headers: { origin: server.base },
  });
  assert.equal(response.status, 200);

  response = await createClient(server.base, server).post('/api/auth/logout', undefined, {
    headers: { origin: 'http://localhost:5173' },
  });
  assert.equal(response.status, 200);

  response = await createClient(server.base, server).post('/api/auth/logout');
  assert.equal(response.status, 200);

  const production = await startServer({ env: { NODE_ENV: 'production' } });
  t.after(() => production.close());
  response = await createClient(production.base, production).post(
    '/api/auth/logout',
    undefined,
    { headers: { origin: 'http://localhost:5173' } },
  );
  assert.equal(response.status, 403, 'production 不再放行 Vite 开发地址');
  response = await createClient(production.base, production).post(
    '/api/auth/logout',
    undefined,
    { headers: { origin: production.base } },
  );
  assert.equal(response.status, 200);

  response = await createClient(server.base, server).get('/api/state', {
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(response.status, 200, 'GET 不是写操作，不拦跨站 Origin');
});

test('安全响应头：CSP 允许 https 头像、禁止内联脚本、nosniff/DENY 等', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const response = await createClient(server.base, server).get('/api/state');

  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const csp = response.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /img-src 'self' data: https:/, 'CSP 必须允许钉钉 https 头像');
  assert.match(csp, /script-src 'self'(?:;|$)/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(response.headers.get('permissions-policy'));
});

test('API 404、405 与 OPTIONS 预检', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const client = createClient(server.base, server);

  let response = await client.get('/api/not-exists');
  assert.equal(response.status, 404);
  assert.equal(response.json.error, 'NOT_FOUND');
  assert.equal(typeof response.json.message, 'string');

  response = await client.post('/api/state', {});
  assert.equal(response.status, 405);
  assert.equal(response.json.error, 'METHOD_NOT_ALLOWED');
  assert.match(response.headers.get('allow') ?? '', /GET/);

  response = await client.request('/api/state', { method: 'OPTIONS' });
  assert.equal(response.status, 204);
});

test('SPA 静态托管与回退：/、/admin、带 hash 的资源、404、路径穿越', async (t) => {
  const dist = mkdtempSync(join(tmpdir(), 'toupiao-dist-'));
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>TP-DIST-MARKER</title>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("ok");');
  const server = await startServer({ clientDir: dist });
  t.after(async () => {
    await server.close();
    rmSync(dist, { recursive: true, force: true });
  });
  const client = createClient(server.base, server);

  let response = await client.get('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(response.text, /TP-DIST-MARKER/);
  assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/);

  response = await client.get('/admin');
  assert.equal(response.status, 200);
  assert.match(response.text, /TP-DIST-MARKER/, '前端路由应回退 index.html');

  response = await client.get('/assets/app.js');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /javascript/);
  assert.match(response.headers.get('cache-control') ?? '', /immutable/);

  response = await client.get('/missing.js');
  assert.equal(response.status, 404);

  for (const path of ['/%2e%2e%2fpackage.json', '/..%2f..%2fpackage.json']) {
    response = await client.get(path);
    assert.equal(response.status, 404, `${path} 不能读取 dist 之外的文件`);
  }

  const noDist = await startServer();
  t.after(() => noDist.close());
  response = await createClient(noDist.base, noDist).get('/');
  assert.equal(response.status, 503);
  assert.match(response.text, /前端尚未构建/);
});

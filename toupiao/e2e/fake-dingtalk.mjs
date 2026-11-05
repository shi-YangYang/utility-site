import { createServer } from 'node:http';

/**
 * 本地假钉钉 OAuth2 服务，仅用于 E2E：
 *   GET  /oauth2/auth                     → 302 回应用回调地址（带 code + state）
 *   POST /v1.0/oauth2/userAccessToken     → JSON accessToken
 *   GET  /v1.0/contact/users/me           → JSON unionId/nick/avatarUrl
 *   GET  /__requests                      → 记录到的请求，便于断言
 *
 * 它不是产品的一部分，也不会被生产代码加载。
 */

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0 || size > MAX_BODY_BYTES) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

export async function startFakeDingTalk({
  host = '127.0.0.1',
  port = 0,
  appKey = 'e2e-app-key',
  appSecret = 'e2e-app-secret',
  profile = {
    unionId: 'e2e-union-1',
    nick: 'E2E 测试员',
    avatarUrl: '',
  },
} = {}) {
  const requests = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    try {
      if (req.method === 'GET' && url.pathname === '/oauth2/auth') {
        const query = Object.fromEntries(url.searchParams.entries());
        requests.push({ type: 'authorize', query });
        if (!query.redirect_uri || !query.state) {
          sendJson(res, 400, { error: 'BAD_AUTHORIZE_REQUEST', message: '缺少 redirect_uri/state' });
          return;
        }
        if (query.response_type !== 'code' || query.client_id !== appKey) {
          sendJson(res, 400, { error: 'BAD_AUTHORIZE_REQUEST', message: '授权参数不正确' });
          return;
        }
        let target;
        try {
          target = new URL(query.redirect_uri);
        } catch {
          sendJson(res, 400, { error: 'BAD_REDIRECT_URI', message: 'redirect_uri 不合法' });
          return;
        }
        target.searchParams.set('code', 'fake-code-1');
        target.searchParams.set('state', query.state);
        res.writeHead(302, {
          Location: target.toString(),
          'Cache-Control': 'no-store',
          'Content-Length': 0,
        });
        res.end();
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1.0/oauth2/userAccessToken') {
        const body = await readJson(req);
        requests.push({ type: 'token', body });
        if (
          body?.clientId !== appKey ||
          body?.clientSecret !== appSecret ||
          body?.grantType !== 'authorization_code' ||
          !body?.code
        ) {
          sendJson(res, 400, { code: 'InvalidAuthentication', message: 'token 请求参数不正确' });
          return;
        }
        sendJson(res, 200, { accessToken: 'fake-access-token', expireIn: 7200 });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1.0/contact/users/me') {
        const token = req.headers['x-acs-dingtalk-access-token'];
        requests.push({ type: 'userinfo', token });
        if (token !== 'fake-access-token') {
          sendJson(res, 401, { code: 'InvalidAuthentication', message: 'access token 不正确' });
          return;
        }
        sendJson(res, 200, profile);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/__requests') {
        sendJson(res, 200, requests);
        return;
      }

      sendJson(res, 404, { error: 'NOT_FOUND', message: '假钉钉服务没有这个接口' });
    } catch (error) {
      sendJson(res, 500, { error: 'FAKE_ERROR', message: String(error?.message ?? error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  return {
    base: `http://${host}:${server.address().port}`,
    requests,
    server,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

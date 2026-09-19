import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { LlmError, recognizeImage, type FetchLike, type FetchResponseLike } from '../llm';

interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface TestServer {
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

function jsonResponse(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function chatBody(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

const VALID_CONTENT = JSON.stringify({
  is_payment: true,
  amount: '23.50',
  direction: 'expense',
  merchant: '肯德基',
  category: '餐饮',
  pay_method: '微信支付',
  platform: '京东',
  tx_time: '2026-09-18 12:30',
  note: '订单 123',
  confidence: 'high',
});

function startServer(
  handler: (request: CapturedRequest, res: http.ServerResponse) => void,
): Promise<TestServer> {
  return new Promise((resolve) => {
    const requests: CapturedRequest[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const captured: CapturedRequest = {
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        requests.push(captured);
        handler(captured, res);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function nodeFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: unknown },
): Promise<FetchResponseLike> {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: init.method, headers: init.headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
          status: response.statusCode ?? 0,
          json: async () => JSON.parse(body),
          text: async () => body,
        });
      });
    });
    request.on('error', reject);
    const signal = init.signal as
      | { addEventListener?: (type: string, listener: () => void) => void }
      | undefined;
    signal?.addEventListener?.('abort', () => request.destroy(new Error('aborted')));
    request.write(init.body);
    request.end();
  });
}

const servers: TestServer[] = [];
const fetchImpl = nodeFetch as unknown as FetchLike;

async function useServer(
  handler: (request: CapturedRequest, res: http.ServerResponse) => void,
): Promise<TestServer> {
  const server = await startServer(handler);
  servers.push(server);
  return server;
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) await server.close();
  }
});

describe('recognizeImage', () => {
  it('成功识别：请求格式与解析结果正确', async () => {
    const server = await useServer((_request, res) => jsonResponse(res, 200, chatBody(VALID_CONTENT)));

    const extraction = await recognizeImage('BASE64DATA', {
      baseUrl: server.baseUrl,
      apiKey: 'sk-test',
      model: 'vision-model',
    }, { fetchImpl });

    expect(extraction.amountCents).toBe(2350);
    expect(extraction.merchant).toBe('肯德基');
    expect(extraction.category).toBe('餐饮');

    expect(server.requests).toHaveLength(1);
    const request = server.requests[0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/v1/chat/completions');
    expect(request.headers.authorization).toBe('Bearer sk-test');
    const body = JSON.parse(request.body);
    expect(body.model).toBe('vision-model');
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,BASE64DATA');
  });

  it('解析失败时用更严格的提示词重试一次', async () => {
    const server = await useServer((request, res) => {
      if (server.requests.length === 1) {
        jsonResponse(res, 200, chatBody('这张图看不太清'));
        return;
      }
      jsonResponse(res, 200, chatBody(VALID_CONTENT));
    });

    const extraction = await recognizeImage('DATA', {
      baseUrl: server.baseUrl,
      apiKey: 'k',
      model: 'm',
    }, { fetchImpl });

    expect(extraction.amountCents).toBe(2350);
    expect(server.requests).toHaveLength(2);
    const secondBody = JSON.parse(server.requests[1].body);
    expect(secondBody.messages[0].content).toContain('上一次回复无法解析');
  });

  it('两次都无法解析时抛 parse 错误', async () => {
    const server = await useServer((_request, res) => jsonResponse(res, 200, chatBody('不是 JSON')));

    await expect(
      recognizeImage('DATA', { baseUrl: server.baseUrl, apiKey: 'k', model: 'm' }, { fetchImpl }),
    ).rejects.toMatchObject({ name: 'LlmError', kind: 'parse' });
    expect(server.requests).toHaveLength(2);
  });

  it('401 归为 auth 错误且不重试', async () => {
    const server = await useServer((_request, res) => jsonResponse(res, 401, { error: 'bad key' }));

    await expect(
      recognizeImage('DATA', { baseUrl: server.baseUrl, apiKey: 'k', model: 'm' }, { fetchImpl }),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(server.requests).toHaveLength(1);
  });

  it('429 归为 rate 错误', async () => {
    const server = await useServer((_request, res) => jsonResponse(res, 429, {}));

    await expect(
      recognizeImage('DATA', { baseUrl: server.baseUrl, apiKey: 'k', model: 'm' }, { fetchImpl }),
    ).rejects.toMatchObject({ kind: 'rate' });
  });

  it('超时归为 timeout 错误', async () => {
    const server = await useServer(() => {
      // 故意不响应，模拟模型挂起
    });

    await expect(
      recognizeImage('DATA', { baseUrl: server.baseUrl, apiKey: 'k', model: 'm' }, {
        fetchImpl,
        timeoutMs: 150,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('网络失败归为 network 错误', async () => {
    const failing: FetchLike = () => Promise.reject(new Error('connect ECONNREFUSED'));

    await expect(
      recognizeImage('DATA', { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k', model: 'm' }, {
        fetchImpl: failing,
      }),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('错误信息可读且带 kind', async () => {
    const error = await recognizeImage(
      'DATA',
      { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k', model: 'm' },
      { fetchImpl: () => Promise.reject(new Error('boom')) },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmError);
  });
});

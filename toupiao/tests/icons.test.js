import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { scanIcons } from '../server/icons.js';
import { createClient, PNG_BYTES, startServer } from './helpers.js';

function makeIconDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'toupiao-icons-'));
  for (const file of files) writeFileSync(join(dir, file), PNG_BYTES);
  return dir;
}

test('图标扫描：按编号排序、解析名称、URL 编码中文与空格', (t) => {
  const dir = makeIconDir(['02_脑机接口.png', '01_无限 连接.png', '10_神经脉冲.png', '03_c.png']);
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const warnings = [];
  const scan = scanIcons(dir, { logger: { warn: (message) => warnings.push(String(message)) } });
  assert.equal(scan.available, true);
  assert.deepEqual(scan.icons.map((icon) => icon.id), ['01', '02', '03', '10']);
  assert.equal(scan.icons[0].name, '无限 连接');
  assert.equal(scan.icons[0].file, '01_无限 连接.png');
  assert.equal(
    scan.icons[0].url,
    '/icons/01_%E6%97%A0%E9%99%90%20%E8%BF%9E%E6%8E%A5.png',
  );
  assert.equal(scan.icons[3].name, '神经脉冲');
  assert.equal(warnings.length, 0);
});

test('图标扫描：编号重复保留第一个并告警，不匹配文件被忽略', (t) => {
  const dir = makeIconDir([
    '01_第一个.png',
    '01_第二个.png',
    '1_编号不足两位.png',
    '02_大写扩展名.PNG',
    '03_不是png.jpg',
    '04_正常.png',
  ]);
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const warnings = [];
  const scan = scanIcons(dir, { logger: { warn: (message) => warnings.push(String(message)) } });
  assert.deepEqual(scan.icons.map((icon) => icon.id), ['01', '04']);
  assert.equal(scan.icons[0].file, '01_第一个.png');
  assert.ok(warnings.some((message) => message.includes('编号重复')));

  const emptyDir = makeIconDir([]);
  t.after(() => rmSync(emptyDir, { recursive: true, force: true }));
  const emptyScan = scanIcons(emptyDir, { logger: { warn: () => {} } });
  assert.equal(emptyScan.available, false);
  assert.deepEqual(emptyScan.icons, []);

  const missing = join(emptyDir, 'does-not-exist');
  const missingScan = scanIcons(missing, { logger: { warn: () => {} } });
  assert.equal(missingScan.available, false);
  assert.deepEqual(missingScan.icons, []);
});

test('图标服务：只服务白名单、正确 Content-Type 与长缓存、路径穿越 404', async (t) => {
  const server = await startServer({ iconFiles: ['01_无限 连接.png'] });
  t.after(() => server.close());
  const client = createClient(server.base, server);

  const state = await client.get('/api/state');
  assert.equal(state.json.iconsAvailable, true);
  const url = state.json.icons[0].url;
  assert.match(url, /^\/icons\/01_%E6%97%A0%E9%99%90%20%E8%BF%9E%E6%8E%A5\.png$/);

  const image = await fetch(server.base + url);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.match(image.headers.get('cache-control') ?? '', /max-age=31536000/);
  assert.match(image.headers.get('cache-control') ?? '', /immutable/);
  const buffer = Buffer.from(await image.arrayBuffer());
  assert.deepEqual([...buffer.subarray(0, 8)], [...PNG_BYTES.subarray(0, 8)]);

  const unknown = await fetch(`${server.base}/icons/09_不存在.png`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, 'ICON_NOT_FOUND');

  for (const path of [
    '/icons/%2e%2e%2fserver%2fconfig.js',
    '/icons/..%2F..%2Fpackage.json',
    '/icons/01_%E6%97%A0%E9%99%90%20%E8%BF%9E%E6%8E%A5.png%2f..%2fconfig.js',
  ]) {
    const response = await fetch(server.base + path);
    assert.equal(response.status, 404, `${path} 必须 404`);
  }
});

test('图标目录缺失或为空：服务正常启动、状态标记与空列表、图片 404', async (t) => {
  const missing = await startServer({ skipIcons: true });
  t.after(() => missing.close());
  let state = await createClient(missing.base, missing).get('/api/state');
  assert.equal(state.status, 200);
  assert.equal(state.json.iconsAvailable, false);
  assert.deepEqual(state.json.icons, []);
  let health = await createClient(missing.base, missing).get('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  let icon = await fetch(`${missing.base}/icons/01_不存在.png`);
  assert.equal(icon.status, 404);

  const empty = await startServer({ iconFiles: [] });
  t.after(() => empty.close());
  state = await createClient(empty.base, empty).get('/api/state');
  assert.equal(state.json.iconsAvailable, false);
  assert.deepEqual(state.json.icons, []);
  health = await createClient(empty.base, empty).get('/api/health');
  assert.equal(health.status, 200);
});

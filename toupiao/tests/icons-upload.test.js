import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import {
  allocateIconId,
  createIconStore,
  MAX_ICON_BYTES,
  scanIcons,
  sanitizeIconName,
  saveUploadedIcon,
  PNG_SIGNATURE,
} from '../server/icons.js';
import { createClient, createSilentLogger, PNG_BYTES, startServer } from './helpers.js';

function upload(client, options = {}) {
  const {
    filename = '测试图标.png',
    body = PNG_BYTES,
    contentType = 'image/png',
    headers = {},
  } = options;
  return client.request(`/api/admin/icons?filename=${encodeURIComponent(filename)}`, {
    method: 'POST',
    rawBody: body,
    headers: { 'content-type': contentType, ...headers },
  });
}

function listPngs(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.png'))
    .sort();
}

test('上传权限：未登录 401、员工 403；管理员成功并立即出现在 state', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const anonymous = createClient(server.base, server);
  const employee = createClient(server.base, server);
  await employee.loginAs('普通员工');
  const admin = createClient(server.base, server);
  await admin.loginAdmin();

  let response = await upload(anonymous);
  assert.equal(response.status, 401);
  assert.equal(response.json.error, 'ADMIN_AUTH_REQUIRED');

  response = await upload(employee);
  assert.equal(response.status, 403);
  assert.equal(response.json.error, 'ADMIN_REQUIRED');
  assert.equal(listPngs(server.config.iconsDir).length, 6, '未授权请求不能落盘');

  response = await upload(admin, { filename: '后台上传.png' });
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.total, 7);
  assert.equal(response.json.iconsAvailable, true);
  assert.equal(response.json.added.length, 1);
  const added = response.json.added[0];
  assert.deepEqual(added, {
    id: '07',
    name: '后台上传',
    file: '07_后台上传.png',
    url: '/icons/07_%E5%90%8E%E5%8F%B0%E4%B8%8A%E4%BC%A0.png',
  });
  assert.ok(existsSync(join(server.config.iconsDir, '07_后台上传.png')));

  const publicState = await anonymous.get('/api/state');
  assert.equal(publicState.status, 200);
  assert.equal(publicState.json.icons.length, 7);
  const publicIcon = publicState.json.icons.find((icon) => icon.id === '07');
  assert.equal(publicIcon.name, '后台上传');
  assert.equal(publicIcon.count, 0);

  const adminState = await admin.get('/api/admin/state');
  assert.equal(adminState.status, 200);
  assert.equal(adminState.json.iconCount, 7);
  assert.ok(adminState.json.icons.some((icon) => icon.id === '07' && icon.count === 0));

  const image = await fetch(server.base + added.url);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 8)], [...PNG_SIGNATURE]);
});

test('上传校验：非 PNG/空文件/截断/错误 Content-Type 400，超过 5MB 413', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const admin = createClient(server.base, server);
  await admin.loginAdmin();

  for (const [label, options] of [
    ['非 PNG 文本', { body: Buffer.from('this is not a png') }],
    ['空文件', { body: Buffer.alloc(0) }],
    ['截断 PNG 头', { body: PNG_SIGNATURE.subarray(0, 5) }],
    ['只有 PNG 签名', { body: PNG_SIGNATURE }],
    ['截断的 PNG（去掉 IEND）', { body: PNG_BYTES.subarray(0, PNG_BYTES.length - 12) }],
    ['错误 Content-Type', { body: PNG_BYTES, contentType: 'text/plain' }],
  ]) {
    const response = await upload(admin, options);
    assert.equal(response.status, 400, `${label} 应 400`);
    assert.equal(response.json.error, 'INVALID_IMAGE', `${label} 错误码`);
  }

  const tooLarge = Buffer.alloc(MAX_ICON_BYTES + 1);
  PNG_SIGNATURE.copy(tooLarge);
  let response = await upload(admin, { body: tooLarge });
  assert.equal(response.status, 413);
  assert.equal(response.json.error, 'PAYLOAD_TOO_LARGE');
  assert.match(response.json.message, /5 MB/);
  assert.equal(listPngs(server.config.iconsDir).length, 6, '被拒绝的上传不能落盘');

  // 边界值：正好 5 MB 接受（真实 PNG + 尾随填充；校验允许 IEND 后尾随字节）。
  const exact = Buffer.alloc(MAX_ICON_BYTES);
  PNG_BYTES.copy(exact);
  response = await upload(admin, { filename: '边界.png', body: exact });
  assert.equal(response.status, 200);
  assert.equal(response.json.added[0].id, '07');
  assert.equal(statSync(join(server.config.iconsDir, '07_边界.png')).size, MAX_ICON_BYTES);
});

test('文件名清洗：去目录/前缀/控制字符/..，空名回落「新图标」，最多 40 字', () => {
  assert.equal(sanitizeIconName('32_测试.png'), '测试');
  assert.equal(sanitizeIconName('../../evil.png'), 'evil');
  assert.equal(sanitizeIconName('..\\..\\evil name.png'), 'evil name');
  assert.equal(sanitizeIconName('目录/子目录/中文 名称.png'), '中文 名称');
  assert.equal(sanitizeIconName('bad\u0000\u001fname.png'), 'badname');
  assert.equal(sanitizeIconName('...png'), '新图标');
  assert.equal(sanitizeIconName('..'), '新图标');
  assert.equal(sanitizeIconName('   '), '新图标');
  assert.equal(sanitizeIconName('01_.png'), '新图标');
  assert.equal(sanitizeIconName('图片.PNG'), '图片');
  assert.equal(Array.from(sanitizeIconName(`${'长'.repeat(60)}.png`)).length, 40);
});

test('路径穿越文件名不会越出 ICONS_DIR，空文件名回落「新图标」', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const admin = createClient(server.base, server);
  await admin.loginAdmin();

  let response = await upload(admin, { filename: '../../../tmp/穿越.png' });
  assert.equal(response.status, 200);
  assert.equal(response.json.added[0].name, '穿越');
  assert.equal(response.json.added[0].file, '07_穿越.png');
  const saved = resolve(server.config.iconsDir, response.json.added[0].file);
  assert.ok(saved.startsWith(`${resolve(server.config.iconsDir)}${sep}`), '落盘文件必须在 ICONS_DIR 内');
  assert.ok(existsSync(saved));

  response = await upload(admin, { filename: '..' });
  assert.equal(response.status, 200);
  assert.equal(response.json.added[0].name, '新图标');
  assert.equal(response.json.added[0].file, '08_新图标.png');
});

test('编号取最小空位；并发上传两张编号不冲突', async (t) => {
  const server = await startServer({ iconFiles: ['01_a.png', '02_b.png', '04_d.png'] });
  t.after(() => server.close());
  const admin = createClient(server.base, server);
  await admin.loginAdmin();

  let response = await upload(admin, { filename: '补空位.png' });
  assert.equal(response.status, 200);
  assert.equal(response.json.added[0].id, '03');

  const [first, second] = await Promise.all([
    upload(admin, { filename: '并发甲.png' }),
    upload(admin, { filename: '并发乙.png' }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const ids = [first.json.added[0].id, second.json.added[0].id].sort();
  assert.deepEqual(ids, ['05', '06'], '并发上传必须拿到不同编号');
  const files = listPngs(server.config.iconsDir);
  assert.equal(files.length, 6);
  for (const name of ['01_a.png', '02_b.png', '03_补空位.png', '04_d.png']) {
    assert.ok(files.includes(name), `缺少 ${name}`);
  }
  for (const response of [first, second]) {
    const added = response.json.added[0];
    assert.ok(['05', '06'].includes(added.id), `并发编号 ${added.id} 必须落在 05/06`);
    assert.equal(added.file, `${added.id}_${added.name}.png`);
    assert.ok(files.includes(added.file), `缺少落盘文件 ${added.file}`);
  }
  const state = await admin.get('/api/admin/state');
  assert.equal(state.json.iconCount, 6);
});

test('上传新图标不影响已有投票；投票关闭时仍可上传', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const employee = createClient(server.base, server);
  await employee.loginAs('已有投票的员工');
  assert.equal((await employee.put('/api/votes/01')).status, 200);
  assert.equal((await employee.put('/api/votes/02')).status, 200);

  const admin = createClient(server.base, server);
  await admin.loginAdmin();
  let response = await upload(admin, { filename: '新增候选.png' });
  assert.equal(response.status, 200);

  let state = await employee.get('/api/state');
  assert.equal(state.json.icons.length, 7);
  assert.equal(state.json.totalVotes, 2);
  assert.equal(state.json.votersCount, 1);
  assert.deepEqual(state.json.myVotes.sort(), ['01', '02']);
  assert.equal(state.json.icons.find((icon) => icon.id === '07').count, 0);

  const closed = await admin.put('/api/admin/settings', { votingOpen: false });
  assert.equal(closed.status, 200);
  response = await upload(admin, { filename: '关闭时上传.png' });
  assert.equal(response.status, 200);
  assert.equal(response.json.added[0].id, '08');
  state = await employee.get('/api/state');
  assert.equal(state.json.votingOpen, false);
  assert.equal(state.json.totalVotes, 2);
  assert.equal(state.json.icons.length, 8);
});

test('已有 99 张图标时返回 409 ICON_LIMIT_REACHED，且不落盘', async (t) => {
  const iconFiles = Array.from(
    { length: 99 },
    (_, index) => `${String(index + 1).padStart(2, '0')}_图标.png`,
  );
  const server = await startServer({ iconFiles });
  t.after(() => server.close());
  const admin = createClient(server.base, server);
  await admin.loginAdmin();

  assert.equal(allocateIconId(server.config.iconsDir), null);
  const response = await upload(admin, { filename: '第100张.png' });
  assert.equal(response.status, 409);
  assert.equal(response.json.error, 'ICON_LIMIT_REACHED');
  assert.match(response.json.message, /99/);
  assert.equal(listPngs(server.config.iconsDir).length, 99);

  const state = await admin.get('/api/admin/state');
  assert.equal(state.json.iconCount, 99);
});

test('00_ 不是有效编号：01–98 已用时仍可分配 99', async (t) => {
  const iconFiles = [
    '00_零.png',
    ...Array.from({ length: 98 }, (_, index) => `${String(index + 1).padStart(2, '0')}_图标.png`),
  ];
  const server = await startServer({ iconFiles });
  t.after(() => server.close());
  const admin = createClient(server.base, server);
  await admin.loginAdmin();

  assert.equal(allocateIconId(server.config.iconsDir), '99');
  const response = await upload(admin, { filename: '最后一位.png' });
  assert.equal(response.status, 200);
  assert.equal(response.json.added[0].id, '99');
  assert.equal(response.json.total, 99);
  assert.equal(listPngs(server.config.iconsDir).length, 100, '00_ 仍在磁盘上但不应计入编号');
});

test('ICONS_DIR 不存在时上传自动创建目录，随后立即生效', async (t) => {
  const server = await startServer({ skipIcons: true });
  t.after(() => server.close());
  const admin = createClient(server.base, server);
  await admin.loginAdmin();

  assert.equal(existsSync(server.config.iconsDir), false);
  let state = await admin.get('/api/admin/state');
  assert.equal(state.json.iconsAvailable, false);

  const response = await upload(admin, { filename: '新目录.png' });
  assert.equal(response.status, 200);
  assert.equal(response.json.total, 1);
  assert.equal(response.json.iconsAvailable, true);
  assert.ok(existsSync(join(server.config.iconsDir, '01_新目录.png')));

  state = await admin.get('/api/admin/state');
  assert.equal(state.json.iconCount, 1);
  assert.equal(state.json.icons[0].name, '新目录');
});

test('ICONS_DIR 不可用（路径是普通文件）时上传返回 500 并提示 ICONS_DIR', async (t) => {
  const server = await startServer({ skipIcons: true });
  t.after(() => server.close());
  writeFileSync(server.config.iconsDir, 'not a directory');
  const admin = createClient(server.base, server);
  await admin.loginAdmin();

  const response = await upload(admin, { filename: '无法保存.png' });
  assert.equal(response.status, 500);
  assert.equal(response.json.error, 'ICONS_DIR_UNAVAILABLE');
  assert.match(response.json.message, /ICONS_DIR/);

  const health = await admin.get('/api/health');
  assert.equal(health.status, 200, '保存失败不能导致服务崩溃');
});

test('createIconStore.reload 重扫同目录并替换白名单；saveUploadedIcon 直接调用可用', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'toupiao-icons-reload-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '01_第一张.png'), PNG_BYTES);
  const logger = createSilentLogger();
  const store = createIconStore(scanIcons(dir, { logger }));
  assert.equal(store.icons.length, 1);
  assert.equal(store.allocateId(), '02');

  writeFileSync(join(dir, '02_外部新增.png'), PNG_BYTES);
  assert.equal(store.icons.length, 1, 'reload 前不感知外部新增');
  assert.equal(store.getById('02'), null);
  store.reload({ logger });
  assert.equal(store.icons.length, 2);
  assert.equal(store.getById('02').name, '外部新增');
  assert.equal(store.allocateId(), '03');

  const saved = await saveUploadedIcon({
    dir,
    buffer: PNG_BYTES,
    originalName: '03_直接保存.png',
    logger,
  });
  assert.deepEqual(saved, {
    id: '03',
    name: '直接保存',
    file: '03_直接保存.png',
    url: '/icons/03_%E7%9B%B4%E6%8E%A5%E4%BF%9D%E5%AD%98.png',
  });
  store.reload({ logger });
  assert.equal(store.icons.length, 3);
  assert.equal(store.getById('03').name, '直接保存');
});

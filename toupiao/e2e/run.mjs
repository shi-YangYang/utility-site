#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startFakeDingTalk } from './fake-dingtalk.mjs';

/**
 * Playwright-core 端到端验收（使用系统 Chrome，不下载浏览器）。
 *
 * 流程：后台登录 → 上传 PNG（临时 ICONS_DIR，前台免重启出现）→ 非 PNG 被拒 →
 *      后台配置钉钉登录 → 假钉钉 OAuth2 跳转/回调 → 登录 → 投 5 票 →
 *      第 6 票被拒 → 取消 → 改投 → 刷新保持 → 后台明细 → 关闭/重开 →
 *      CSV → 重置 → UI 清理与安全自查。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = join(ROOT, 'e2e', 'artifacts');
const ICONS_DIR = join(ROOT, 'assets', 'icons');
const E2E_ADMIN_PASSWORD = 'e2e-admin-123';
const E2E_APP_KEY = 'e2e-app-key';
const E2E_APP_SECRET = 'e2e-app-secret';
const E2E_CORP_ID = 'e2e-corp';

const steps = [];

function step(name) {
  steps.push(name);
  console.log(`\n▶ ${name}`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForHealth(base, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`服务未在 ${timeoutMs}ms 内就绪：${lastError?.message ?? '未知错误'}`);
}

async function dismissToasts(page) {
  await page
    .evaluate(() => {
      for (const button of document.querySelectorAll('.toast-close')) button.click();
    })
    .catch(() => {});
  await sleep(80);
}

async function clickIcon(page, id) {
  await page.locator(`[data-icon-id="${id}"] .icon-button`).click({ position: { x: 18, y: 18 } });
}

async function expectAdminTotal(page, expected) {
  await page.waitForFunction(
    (value) =>
      document.querySelector('[data-testid="admin-total-votes"]')?.textContent.trim() === value,
    String(expected),
  );
}

async function expectNoHorizontalScroll(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `${label} 不应横向滚动（超出 ${overflow}px）`);
}

async function normalizedText(locator) {
  return (await locator.innerText()).replace(/\s+/g, ' ').trim();
}

async function main() {
  if (!existsSync(ICONS_DIR)) {
    throw new Error(`图标目录不存在：${ICONS_DIR}`);
  }
  const pngCount = readdirSync(ICONS_DIR).filter((name) => name.endsWith('.png')).length;
  if (pngCount === 0) {
    throw new Error(`图标目录没有 PNG：${ICONS_DIR}（E2E 需要真实候选图）`);
  }
  mkdirSync(ARTIFACTS, { recursive: true });

  step('构建前端（npm run build）');
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const build = spawnSync(
    process.execPath,
    [viteBin, 'build', '--config', 'client/vite.config.js'],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (build.status !== 0) throw new Error('前端构建失败');

  const fake = await startFakeDingTalk();
  // E2E 只往临时 ICONS_DIR 上传，避免在仓库 assets/icons 留下 32_*.png。
  const tempRoot = mkdtempSync(join(tmpdir(), 'toupiao-e2e-'));
  const dataDir = join(tempRoot, 'data');
  const iconsDir = join(tempRoot, 'icons');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(iconsDir, { recursive: true });
  const sourcePngs = readdirSync(ICONS_DIR)
    .filter((name) => name.endsWith('.png'))
    .sort();
  for (const name of sourcePngs) {
    copyFileSync(join(ICONS_DIR, name), join(iconsDir, name));
  }
  assert.equal(
    readdirSync(iconsDir).filter((name) => name.endsWith('.png')).length,
    pngCount,
    '临时图标目录应包含全部候选图',
  );
  const expectedIconCount = pngCount + 1;
  const uploadPngPath = join(tempRoot, 'E2E 新图标.png');
  copyFileSync(join(ICONS_DIR, sourcePngs[0]), uploadPngPath);
  const badImagePath = join(tempRoot, 'not-a-png.txt');
  writeFileSync(badImagePath, 'this is not a png');
  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  const serverLogPath = join(ARTIFACTS, 'server.log');
  const serverLog = createWriteStream(serverLogPath, { flags: 'w' });
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ENV_FILE: join(dataDir, 'missing.env'),
      AUTH_MODE: '',
      DINGTALK_APP_KEY: '',
      DINGTALK_APP_SECRET: '',
      DINGTALK_CORP_ID: '',
      PUBLIC_BASE_URL: '',
      DINGTALK_TEST_BASE: fake.base,
      ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
      SESSION_SECRET: `e2e-session-secret-${'x'.repeat(40)}`,
      DATA_DIR: dataDir,
      ICONS_DIR: iconsDir,
      PORT: String(port),
      NODE_ENV: 'test',
      TRUST_PROXY: '0',
      COOKIE_SECURE: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.pipe(serverLog);
  server.stderr.pipe(serverLog);

  let browser;
  let dingtalkSaved = false;
  try {
    step('等待服务 healthy');
    await waitForHealth(base);

    browser = await chromium.launch({
      channel: 'chrome',
      headless: process.env.HEADED !== '1',
    });
    const userContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
    });
    const page = await userContext.newPage();
    page.setDefaultTimeout(15000);

    step(`A1 未登录浏览 ${pngCount} 个图标与实时票数，状态栏/hero 无重复入口`);
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('.icon-grid .icon-card').first().waitFor();
    assert.equal(await page.locator('.icon-grid .icon-card').count(), pngCount);
    await page.waitForFunction(() => {
      const image = document.querySelector('.icon-card img');
      return Boolean(image && image.complete && image.naturalWidth > 0);
    });
    assert.equal((await page.locator('[data-testid="total-votes"]').innerText()).trim(), '0');
    assert.equal((await page.locator('[data-testid="voters-count"]').innerText()).trim(), '0');
    assert.equal(await page.locator('.hero-stats .hero-stat').count(), 2, 'hero 只保留总票数/参与人数');
    assert.equal(await page.locator('.hero').getByText('我的票数').count(), 0);
    const initialStatusBar = await normalizedText(page.locator('.status-bar'));
    assert.ok(initialStatusBar.includes('已投'), '状态栏应保留已投 X/5');
    assert.equal(initialStatusBar.includes('剩余'), false, '状态栏不应再有“剩余 X 票”');
    assert.equal(initialStatusBar.includes('登录后投票'), false, '状态栏不应再有登录入口');
    const initialPublicState = await page.evaluate(async () => (await fetch('/api/state')).json());
    assert.equal(initialPublicState.loginConfigured, false);
    assert.equal('authMode' in initialPublicState, false);

    step('A2 未配置钉钉时点登录 → 登录暂未开放');
    await clickIcon(page, '01');
    await page.locator('.toast', { hasText: '登录暂未开放' }).waitFor();
    assert.equal(await page.locator('.login-dialog').count(), 0, '未配置时不应弹出登录框');
    await dismissToasts(page);

    step('A1 POST /api/auth/mock 已删除（404）');
    const mockStatus = await page.evaluate(async () => {
      const response = await fetch('/api/auth/mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '旧 mock 用户' }),
      });
      return response.status;
    });
    assert.equal(mockStatus, 404);

    step('C1 后台登录（错误口令 + 正确口令）');
    const adminContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const adminPage = await adminContext.newPage();
    adminPage.setDefaultTimeout(15000);
    await adminPage.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
    await adminPage.locator('#admin-password').waitFor();
    await adminPage.fill('#admin-password', 'wrong-password');
    await adminPage.getByRole('button', { name: '进入后台' }).click();
    await adminPage.locator('.form-error').waitFor();
    assert.match(await adminPage.locator('.form-error').innerText(), /不正确/);
    await adminPage.fill('#admin-password', E2E_ADMIN_PASSWORD);
    await adminPage.getByRole('button', { name: '进入后台' }).click();
    await adminPage.getByRole('heading', { name: '投票管理' }).waitFor();
    await adminPage.locator('[data-testid="admin-total-votes"]').waitFor();
    await expectAdminTotal(adminPage, 0);
    assert.equal(
      (await normalizedText(adminPage.locator('[data-testid="dingtalk-status"]'))).includes(
        '未配置',
      ),
      true,
    );
    assert.equal(
      (await normalizedText(adminPage.locator('.control-panel .status-pill'))).includes('进行中'),
      true,
      '管理端投票开关面板应有状态 pill',
    );

    step(`A2 后台上传 1 张 PNG：图标数 ${pngCount} → ${expectedIconCount}，前台免重启出现且 0 票`);
    await adminPage.locator('#icon-upload-input').waitFor({ state: 'attached' });
    await adminPage.setInputFiles('#icon-upload-input', uploadPngPath);
    await adminPage.getByRole('button', { name: '开始上传' }).click();
    await adminPage
      .locator('[data-testid="icon-upload-result"]', { hasText: '成功上传 1 张' })
      .waitFor();
    await adminPage.waitForFunction(
      (expected) =>
        document
          .querySelector('[data-testid="icon-count"]')
          ?.textContent.replace(/\s+/g, ' ')
          .trim() === expected,
      `当前 ${expectedIconCount} / 99`,
    );
    await adminPage.waitForFunction(
      (expected) =>
        document.querySelectorAll('[data-testid="admin-icons-table"] tbody tr').length === expected,
      expectedIconCount,
    );
    const adminStateAfterUpload = await adminPage.evaluate(async () =>
      (await fetch('/api/admin/state')).json(),
    );
    assert.equal(adminStateAfterUpload.iconCount, expectedIconCount);
    const uploadedAdminIcon = adminStateAfterUpload.icons.find(
      (icon) => icon.name === 'E2E 新图标',
    );
    assert.ok(uploadedAdminIcon, '上传后后台 state 应立即包含新图标');
    assert.equal(uploadedAdminIcon.count, 0, '新图标初始 0 票');

    // 用户页仍停在旧数据上；bringToFront 触发可见性刷新，再等 5 秒轮询把新图标带出来。
    await page.bringToFront();
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.icon-grid .icon-card').length === expected,
      expectedIconCount,
      { timeout: 20000 },
    );
    const uploadedCard = page.locator('.icon-card', { hasText: 'E2E 新图标' });
    await uploadedCard.waitFor();
    assert.equal(await normalizedText(uploadedCard.locator('.icon-meta')), '0 票');
    // 新图标在列表末尾，懒加载图片需要先滚入视口。
    await uploadedCard.scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => {
        const card = [...document.querySelectorAll('.icon-card')].find((node) =>
          node.textContent.includes('E2E 新图标'),
        );
        const image = card?.querySelector('img');
        return Boolean(image && image.complete && image.naturalWidth > 0);
      },
      undefined,
      { timeout: 10000 },
    );
    await page.screenshot({
      path: join(ARTIFACTS, 'vote-icon-uploaded.png'),
      fullPage: true,
    });
    await adminPage.bringToFront();
    await adminPage.screenshot({
      path: join(ARTIFACTS, 'admin-icon-upload.png'),
      fullPage: true,
    });
    assert.equal(
      (await adminPage.locator('#icon-upload-input').getAttribute('accept')),
      'image/png',
    );
    assert.notEqual(
      await adminPage.locator('#icon-upload-input').getAttribute('multiple'),
      null,
      '上传输入必须支持多选',
    );

    step('A4 非 PNG 上传被拒：显示可读错误且不增加图标');
    await adminPage.setInputFiles('#icon-upload-input', badImagePath);
    await adminPage.getByRole('button', { name: '开始上传' }).click();
    await adminPage
      .locator('[data-testid="icon-upload-result"]', { hasText: '成功上传 0 张' })
      .waitFor();
    const failedUploadStatus = adminPage.locator('[data-testid="icon-upload-file-status"].is-error');
    await failedUploadStatus.waitFor();
    assert.match(await failedUploadStatus.innerText(), /PNG/);
    const stateAfterBadUpload = await adminPage.evaluate(async () =>
      (await fetch('/api/admin/state')).json(),
    );
    assert.equal(stateAfterBadUpload.iconCount, expectedIconCount, '非法上传不能增加图标');
    await adminPage.waitForFunction(
      (expected) =>
        document
          .querySelector('[data-testid="icon-count"]')
          ?.textContent.replace(/\s+/g, ' ')
          .trim() === expected,
      `当前 ${expectedIconCount} / 99`,
    );

    step('F6 后台填写钉钉配置并保存');
    await adminPage.locator('#dingtalk-base-url').waitFor();
    await adminPage.fill('#dingtalk-base-url', base);
    await adminPage.fill('#dingtalk-app-key', E2E_APP_KEY);
    await adminPage.fill('#dingtalk-app-secret', E2E_APP_SECRET);
    await adminPage.fill('#dingtalk-corp-id', E2E_CORP_ID);
    assert.equal(
      await adminPage.locator('#dingtalk-callback').inputValue(),
      `${base}/api/auth/callback`,
      '回调地址应由站点地址生成',
    );
    await adminPage.getByRole('button', { name: '保存配置' }).click();
    await adminPage.locator('[data-testid="dingtalk-result"]', { hasText: '已保存' }).waitFor();
    await adminPage.waitForFunction(
      () =>
        document.querySelector('[data-testid="dingtalk-status"]')?.textContent.trim() === '已配置',
    );
    assert.equal(
      await adminPage.locator('#dingtalk-app-secret').inputValue(),
      '',
      '保存后 AppSecret 输入框应为空',
    );
    assert.equal(
      await adminPage.locator('#dingtalk-app-secret').getAttribute('placeholder'),
      '已保存，留空不修改',
    );
    assert.equal(
      await adminPage.locator('#dingtalk-callback').inputValue(),
      `${base}/api/auth/callback`,
    );
    assert.notEqual(
      await adminPage.locator('#dingtalk-callback').getAttribute('readonly'),
      null,
      '回调地址必须是只读输入框',
    );
    await adminPage.getByRole('button', { name: '复制' }).click();
    await adminPage.getByRole('button', { name: '已复制' }).waitFor();
    assert.equal(
      await adminPage.evaluate(() => navigator.clipboard.readText()),
      `${base}/api/auth/callback`,
      '复制按钮应写入回调地址',
    );
    const adminConfig = await adminPage.evaluate(async () =>
      (await fetch('/api/admin/dingtalk')).json(),
    );
    assert.equal(adminConfig.configured, true);
    assert.equal(adminConfig.hasSecret, true);
    assert.equal(JSON.stringify(adminConfig).includes(E2E_APP_SECRET), false);
    assert.equal((await adminPage.content()).includes(E2E_APP_SECRET), false, 'DOM 不能包含 AppSecret');
    await adminPage.screenshot({ path: join(ARTIFACTS, 'admin-dingtalk-config.png'), fullPage: true });
    dingtalkSaved = true;

    step('退出后台');
    await adminPage.locator('.header-actions').getByRole('button', { name: '退出后台' }).click();
    await adminPage.locator('#admin-password').waitFor();

    step('F5 前台点登录 → 假钉钉授权 → 回调 → 登录成功');
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('.icon-grid .icon-card').first().waitFor();
    await clickIcon(page, '01');
    await page.locator('.login-dialog').waitFor();
    assert.equal(await page.locator('#mock-name').count(), 0, '登录弹窗不应再有 mock 姓名表单');
    assert.equal(await page.locator('.login-dialog .form-error').count(), 0);
    await page.getByRole('link', { name: '使用钉钉登录' }).waitFor();
    await sleep(250);
    await page.screenshot({ path: join(ARTIFACTS, 'login-dialog.png') });
    await Promise.all([
      page.waitForURL((url) => url.origin === base && url.pathname === '/', { timeout: 20000 }),
      page.getByRole('link', { name: '使用钉钉登录' }).click(),
    ]);
    await page.locator('.user-name', { hasText: 'E2E 测试员' }).waitFor({ timeout: 20000 });
    const authorizeRequests = fake.requests.filter((request) => request.type === 'authorize');
    assert.equal(authorizeRequests.length, 1, '应完成一次钉钉授权跳转');
    const authorizeQuery = authorizeRequests[0].query;
    assert.equal(authorizeQuery.client_id, E2E_APP_KEY);
    assert.equal(authorizeQuery.response_type, 'code');
    assert.equal(authorizeQuery.scope, 'openid corpid');
    assert.equal(authorizeQuery.prompt, 'consent');
    assert.equal(authorizeQuery.corpId, E2E_CORP_ID);
    assert.equal(authorizeQuery.redirect_uri, `${base}/api/auth/callback`);
    assert.ok((authorizeQuery.state ?? '').length >= 20);
    const tokenRequests = fake.requests.filter((request) => request.type === 'token');
    assert.equal(tokenRequests.length, 1);
    assert.equal(tokenRequests[0].body.clientId, E2E_APP_KEY);
    assert.equal(tokenRequests[0].body.clientSecret, E2E_APP_SECRET);
    assert.equal(tokenRequests[0].body.code, 'fake-code-1');
    assert.equal(tokenRequests[0].body.grantType, 'authorization_code');
    const userinfoRequests = fake.requests.filter((request) => request.type === 'userinfo');
    assert.equal(userinfoRequests.length, 1);
    assert.equal(userinfoRequests[0].token, 'fake-access-token');
    const loggedInState = await page.evaluate(async () => (await fetch('/api/state')).json());
    assert.equal(loggedInState.loginConfigured, true);
    assert.equal(loggedInState.user.nick, 'E2E 测试员');

    step('B1 投 5 个不同图标');
    for (const [index, id] of ['01', '02', '03', '04', '05'].entries()) {
      await clickIcon(page, id);
      await page.locator(`[data-icon-id="${id}"] .icon-button[aria-pressed="true"]`).waitFor();
      await page.waitForFunction(
        (count) =>
          document.querySelector('[data-testid="my-votes-count"]')?.textContent.trim() === count,
        `${index + 1}/5`,
      );
    }
    await dismissToasts(page);
    assert.equal((await page.locator('[data-testid="my-votes-count"]').innerText()).trim(), '5/5');
    assert.equal((await page.locator('[data-testid="total-votes"]').innerText()).trim(), '5');
    assert.equal((await page.locator('[data-testid="voters-count"]').innerText()).trim(), '1');
    const zeroVoteMeta = await normalizedText(page.locator('[data-icon-id="20"] .icon-meta'));
    assert.equal(zeroVoteMeta, '0 票', '0 票卡片只显示票数，不显示排名');
    assert.equal(await page.locator('[data-icon-id="20"] .rank-badge').count(), 0);

    step('B1 第 6 票被拒且数据不变');
    await clickIcon(page, '06');
    await page.locator('.toast-error', { hasText: '最多投 5 个' }).waitFor();
    assert.equal(
      await page.locator('[data-icon-id="06"] .icon-button').getAttribute('aria-pressed'),
      'false',
    );
    assert.equal((await page.locator('[data-testid="my-votes-count"]').innerText()).trim(), '5/5');
    await dismissToasts(page);

    step('B3 取消 1 票并改投另一个图标');
    await clickIcon(page, '03');
    await page.locator('[data-icon-id="03"] .icon-button[aria-pressed="false"]').waitFor();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="my-votes-count"]')?.textContent.trim() === '4/5',
    );
    await clickIcon(page, '06');
    await page.locator('[data-icon-id="06"] .icon-button[aria-pressed="true"]').waitFor();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="my-votes-count"]')?.textContent.trim() === '5/5',
    );
    await dismissToasts(page);

    step('A4 刷新页面后会话与 5 票仍在');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.icon-grid .icon-card').first().waitFor();
    await page.locator('.user-name', { hasText: 'E2E 测试员' }).waitFor();
    assert.equal((await page.locator('[data-testid="my-votes-count"]').innerText()).trim(), '5/5');
    assert.equal(await page.locator('.icon-button[aria-pressed="true"]').count(), 5);
    const stateAfterReload = await page.evaluate(async () => (await fetch('/api/state')).json());
    assert.equal(stateAfterReload.myVotes.length, 5);
    assert.ok(stateAfterReload.myVotes.includes('06'));
    assert.ok(!stateAfterReload.myVotes.includes('03'));
    assert.equal(stateAfterReload.user.nick, 'E2E 测试员');
    await expectNoHorizontalScroll(page, '1440px 前台');
    await page.screenshot({ path: join(ARTIFACTS, 'vote-desktop.png'), fullPage: true });

    step('D1 375px 移动端两列、无横向滚动');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.icon-grid .icon-card').first().waitFor();
    const mobileLayout = await page.evaluate(() => {
      const grid = document.querySelector('.icon-grid');
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    assert.equal(mobileLayout.columns, 2, '移动端应为两列');
    assert.ok(
      mobileLayout.scrollWidth <= mobileLayout.innerWidth + 1,
      `375px 不应横向滚动（${mobileLayout.scrollWidth} > ${mobileLayout.innerWidth}）`,
    );
    assert.ok(await page.locator('[data-testid="my-votes-count"]').isVisible());
    const mobileStatusBar = await normalizedText(page.locator('.status-bar'));
    assert.equal(mobileStatusBar.includes('剩余'), false);
    assert.equal(mobileStatusBar.includes('登录后投票'), false);
    await page.screenshot({ path: join(ARTIFACTS, 'vote-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });

    step('C2/C3 后台总览、投票人明细与钉钉配置持久化');
    await adminPage.locator('#admin-password').waitFor();
    await adminPage.fill('#admin-password', E2E_ADMIN_PASSWORD);
    await adminPage.getByRole('button', { name: '进入后台' }).click();
    await adminPage.getByRole('heading', { name: '投票管理' }).waitFor();
    await expectAdminTotal(adminPage, 5);
    assert.equal(
      (await adminPage.locator('[data-testid="admin-voters-count"]').innerText()).trim(),
      '1',
    );
    const votersText = await adminPage.locator('.voters-table').innerText();
    assert.match(votersText, /E2E 测试员/);
    assert.equal(await adminPage.locator('.voters-table .vote-chips li').count(), 5);
    await adminPage.waitForFunction(
      () =>
        document.querySelector('[data-testid="dingtalk-status"]')?.textContent.trim() === '已配置',
    );
    assert.equal((await adminPage.content()).includes(E2E_APP_SECRET), false, '后台 DOM 不能包含 AppSecret');
    await dismissToasts(adminPage);
    await adminPage.screenshot({ path: join(ARTIFACTS, 'admin-dashboard.png'), fullPage: true });
    await adminPage.setViewportSize({ width: 375, height: 812 });
    await adminPage.reload({ waitUntil: 'domcontentloaded' });
    await adminPage.getByRole('heading', { name: '投票管理' }).waitFor();
    await adminPage.locator('[data-testid="dingtalk-panel"]').waitFor();
    await expectNoHorizontalScroll(adminPage, '管理后台 375px');
    await adminPage.screenshot({ path: join(ARTIFACTS, 'admin-mobile.png'), fullPage: true });
    await adminPage.setViewportSize({ width: 1440, height: 900 });

    step('后台管理员会话不能投票（403）');
    const adminVoteStatus = await adminPage.evaluate(async () => {
      const response = await fetch('/api/votes/01', { method: 'PUT' });
      return response.status;
    });
    assert.equal(adminVoteStatus, 403);

    step('B5 关闭投票 → 前台冻结');
    await adminPage.getByRole('button', { name: '关闭投票' }).click();
    await adminPage.getByRole('button', { name: '开启投票' }).waitFor();
    assert.equal(
      (await normalizedText(adminPage.locator('.control-panel .status-pill'))).includes('已关闭'),
      true,
    );

    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('.closed-banner').waitFor();
    assert.match(await page.locator('.closed-banner').innerText(), /投票已结束/);
    await dismissToasts(page);
    const closedState = await page.evaluate(async () => (await fetch('/api/state')).json());
    assert.equal(closedState.votingOpen, false);
    const totalBeforeClosedClick = closedState.totalVotes;

    await clickIcon(page, '07');
    await page.locator('.toast-error', { hasText: '投票已结束' }).waitFor();
    const closedAfterClick = await page.evaluate(async () => (await fetch('/api/state')).json());
    assert.equal(closedAfterClick.totalVotes, totalBeforeClosedClick);
    assert.ok(!closedAfterClick.myVotes.includes('07'));
    await page.screenshot({ path: join(ARTIFACTS, 'vote-closed.png'), fullPage: true });
    await dismissToasts(page);

    step('C4 重新开启投票');
    await adminPage.getByRole('button', { name: '开启投票' }).click();
    await adminPage.getByRole('button', { name: '关闭投票' }).waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.icon-grid .icon-card').first().waitFor();
    await page.locator('.closed-banner').waitFor({ state: 'detached' });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="my-votes-count"]')?.textContent.trim() === '5/5',
    );

    step('C5 导出 CSV（BOM + 数据一致）');
    const downloadPromise = adminPage.waitForEvent('download');
    await adminPage.getByRole('link', { name: '导出 CSV' }).click();
    const download = await downloadPromise;
    const csvPath = join(ARTIFACTS, 'toupiao-export.csv');
    await download.saveAs(csvPath);
    assert.match(download.suggestedFilename(), /^toupiao-\d{4}-\d{2}-\d{2}\.csv$/);
    const csvBuffer = readFileSync(csvPath);
    assert.deepEqual([...csvBuffer.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'CSV 缺少 UTF-8 BOM');
    const csvText = csvBuffer.toString('utf8').slice(1);
    const csvLines = csvText.trimEnd().split('\r\n');
    assert.equal(csvLines[0], '姓名,图标编号,图标名称,投票时间');
    assert.equal(csvLines.length, 6, '表头 + 5 条投票');
    assert.ok(csvText.includes('E2E 测试员'));
    assert.ok(csvText.includes(',06,人机融合,'), 'CSV 应包含改投后的图标 06');

    step('C6 重置投票（必须输入 RESET）');
    await adminPage.getByRole('button', { name: '重置投票…' }).click();
    const resetInput = adminPage.locator('#reset-confirm');
    await resetInput.waitFor();
    await resetInput.fill('reset');
    const confirmReset = adminPage.getByRole('button', { name: '确认重置' });
    assert.equal(await confirmReset.isDisabled(), true, '小写 reset 不能确认');
    await resetInput.fill('RESET');
    assert.equal(await confirmReset.isDisabled(), false);
    await confirmReset.click();
    await expectAdminTotal(adminPage, 0);
    await adminPage.screenshot({ path: join(ARTIFACTS, 'admin-reset.png'), fullPage: true });

    step('C6 重置后公众统计归零、用户保留、0 票卡片无排名');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.icon-grid .icon-card').first().waitFor();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="total-votes"]')?.textContent.trim() === '0',
    );
    assert.equal((await page.locator('[data-testid="my-votes-count"]').innerText()).trim(), '0/5');
    await page.locator('.user-name', { hasText: 'E2E 测试员' }).waitFor();
    const metas = await page.locator('.icon-meta').allInnerTexts();
    assert.equal(metas.length, expectedIconCount);
    for (const meta of metas) {
      assert.match(meta.replace(/\s+/g, ' ').trim(), /^0 票$/, '重置后 0 票卡片不应显示排名');
    }
    assert.equal(await page.locator('.rank-badge').count(), 0);
    const finalStatusBar = await normalizedText(page.locator('.status-bar'));
    assert.equal(finalStatusBar.includes('剩余'), false);
    assert.equal(finalStatusBar.includes('登录后投票'), false);
    await expectNoHorizontalScroll(page, '重置后 1440px 前台');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.icon-grid .icon-card').first().waitFor();
    await expectNoHorizontalScroll(page, '重置后 375px 前台');
    await page.setViewportSize({ width: 1440, height: 900 });

    console.log(`\n✅ E2E 全部通过（${steps.length} 个步骤）`);
    for (const name of steps) console.log(`   ✓ ${name}`);
    console.log(`\n截图与 CSV：${ARTIFACTS}`);
  } catch (error) {
    console.error('\n❌ E2E 失败：', error);
    if (browser) {
      const pages = browser.contexts().flatMap((context) => context.pages());
      const page = pages[0];
      if (page && !page.isClosed()) {
        await page
          .screenshot({ path: join(ARTIFACTS, 'failure.png'), fullPage: true })
          .catch(() => {});
      }
    }
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fake.close().catch(() => {});
    server.kill('SIGTERM');
    await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        server.kill('SIGKILL');
        resolvePromise();
      }, 5000);
      server.once('exit', () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
    serverLog.end();
    await sleep(100);

    try {
      const logText = readFileSync(serverLogPath, 'utf8');
      assert.equal(logText.includes(E2E_APP_SECRET), false, '服务日志不能包含 AppSecret');
      assert.equal(logText.includes('AUTH_MODE=mock'), false, '日志不应再出现 AUTH_MODE mock');
      if (dingtalkSaved) {
        const db = new DatabaseSync(join(dataDir, 'toupiao.db'), { readOnly: true });
        try {
          const row = db
            .prepare("SELECT value FROM settings WHERE key = 'dingtalk.app_secret_enc'")
            .get();
          assert.ok(row?.value?.startsWith('v1:'), '数据库应保存 v1 密文');
          assert.equal(row.value.includes(E2E_APP_SECRET), false, '数据库不能出现明文 AppSecret');
        } finally {
          db.close();
        }
      }
    } catch (error) {
      console.error('❌ E2E 安全自查失败：', error);
      process.exitCode = 1;
    }

    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('❌ E2E 启动失败：', error);
  process.exit(1);
});

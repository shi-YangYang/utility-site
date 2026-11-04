#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

/**
 * Playwright-core 端到端验收（使用系统 Chrome，不下载浏览器）。
 * 流程：mock 登录 → 投 5 票 → 第 6 票被拒 → 取消 → 改投 → 刷新保持 →
 *      后台登录 → 看明细 → 关闭投票 → 前台冻结 → 重新开启 → 导出 CSV → 重置。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = join(ROOT, 'e2e', 'artifacts');
const ICONS_DIR = join(ROOT, 'assets', 'icons');
const E2E_ADMIN_PASSWORD = 'e2e-admin-123';

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

  const dataDir = mkdtempSync(join(tmpdir(), 'toupiao-e2e-'));
  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  const serverLog = createWriteStream(join(ARTIFACTS, 'server.log'), { flags: 'w' });
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ENV_FILE: join(dataDir, 'missing.env'),
      AUTH_MODE: 'mock',
      ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
      SESSION_SECRET: `e2e-session-secret-${'x'.repeat(40)}`,
      PUBLIC_BASE_URL: base,
      DATA_DIR: dataDir,
      ICONS_DIR,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      TRUST_PROXY: '0',
      COOKIE_SECURE: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.pipe(serverLog);
  server.stderr.pipe(serverLog);

  let browser;
  const userContexts = [];
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
    userContexts.push(userContext);
    const page = await userContext.newPage();
    page.setDefaultTimeout(15000);

    step('A1 未登录浏览 20 个图标与实时票数');
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('.icon-grid .icon-card').first().waitFor();
    assert.equal(await page.locator('.icon-grid .icon-card').count(), pngCount);
    assert.equal(await page.locator('.icon-grid .icon-card').count(), 20);
    assert.match(await page.locator('.dev-badge').innerText(), /开发模式/);
    await page.waitForFunction(() => {
      const image = document.querySelector('.icon-card img');
      return Boolean(image && image.complete && image.naturalWidth > 0);
    });
    assert.equal((await page.locator('[data-testid="total-votes"]').innerText()).trim(), '0');

    step('A3 未登录点投票 → 登录弹窗（开发模式标识）');
    await clickIcon(page, '01');
    await page.locator('.login-dialog').waitFor();
    assert.match(await page.locator('.login-dialog').innerText(), /开发模式/);
    await page.screenshot({ path: join(ARTIFACTS, 'login-dialog.png'), fullPage: true });

    step('A3 mock 输入姓名登录');
    await page.fill('#mock-name', 'E2E 测试员');
    await page.getByRole('button', { name: '进入投票' }).click();
    await page.locator('.login-dialog').waitFor({ state: 'detached' });
    await page.locator('.user-name', { hasText: 'E2E 测试员' }).waitFor();

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
    const stateAfterReload = await page.evaluate(async () =>
      (await fetch('/api/state')).json(),
    );
    assert.equal(stateAfterReload.myVotes.length, 5);
    assert.ok(stateAfterReload.myVotes.includes('06'));
    assert.ok(!stateAfterReload.myVotes.includes('03'));
    assert.equal(stateAfterReload.user.nick, 'E2E 测试员');
    const desktopOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert.ok(desktopOverflow <= 1, `1440px 不应横向滚动（超出 ${desktopOverflow}px）`);
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
    await page.screenshot({ path: join(ARTIFACTS, 'vote-mobile.png'), fullPage: true });

    step('C1/C2/C3 后台登录、总览与投票人明细');
    const adminContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
    });
    userContexts.push(adminContext);
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
    await expectAdminTotal(adminPage, 5);
    assert.equal(
      (await adminPage.locator('[data-testid="admin-voters-count"]').innerText()).trim(),
      '1',
    );
    const votersText = await adminPage.locator('.voters-table').innerText();
    assert.match(votersText, /E2E 测试员/);
    assert.equal(await adminPage.locator('.voters-table .vote-chips li').count(), 5);
    await adminPage.screenshot({ path: join(ARTIFACTS, 'admin-dashboard.png'), fullPage: true });

    step('后台管理员会话不能投票（403）');
    const adminVoteStatus = await adminPage.evaluate(async () => {
      const response = await fetch('/api/votes/01', { method: 'PUT' });
      return response.status;
    });
    assert.equal(adminVoteStatus, 403);

    step('B5 关闭投票 → 前台冻结');
    await adminPage.getByRole('button', { name: '关闭投票' }).click();
    await adminPage.getByRole('button', { name: '开启投票' }).waitFor();

    await page.setViewportSize({ width: 1440, height: 900 });
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

    step('C6 重置后公众统计归零、用户保留');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.icon-grid .icon-card').first().waitFor();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="total-votes"]')?.textContent.trim() === '0',
    );
    assert.equal((await page.locator('[data-testid="my-votes-count"]').innerText()).trim(), '0/5');
    await page.locator('.user-name', { hasText: 'E2E 测试员' }).waitFor();

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
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('❌ E2E 启动失败：', error);
  process.exit(1);
});

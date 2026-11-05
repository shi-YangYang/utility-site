import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 本地开发：并行启动后端（3001）与 Vite（5173），统一转发信号。
 * 生产部署不经过这个脚本。
 */
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const viteBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');

if (!existsSync(viteBin)) {
  console.error('[dev] 找不到 vite，请先运行 npm install');
  process.exit(1);
}

const children = [];
let exiting = false;

function start(name, command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(`[dev] ${name} 启动失败：${error.message}`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (exiting) return;
    console.error(`[dev] ${name} 已退出（code=${code}, signal=${signal}），正在停止另一个进程`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (exiting) return;
  exiting = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 500);
}

start('server', process.execPath, ['--watch', 'server/index.js']);
start('vite', viteBin, ['--config', 'client/vite.config.js']);

process.on('SIGINT', () => {
  console.log('[dev] 收到 SIGINT，正在停止…');
  shutdown(0);
});
process.on('SIGTERM', () => {
  console.log('[dev] 收到 SIGTERM，正在停止…');
  shutdown(0);
});
process.on('exit', () => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
});


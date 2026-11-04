#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createStore, DatabaseError } from './db.js';
import { resolveDingTalkSettings } from './dingtalk-config.js';
import { createIconStore, scanIcons } from './icons.js';

function loadEnvFile() {
  const envPath = process.env.ENV_FILE
    ? resolve(process.env.ENV_FILE)
    : resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    console.error(`[toupiao] 无法读取环境变量文件 ${envPath}：${error.message}`);
    process.exit(1);
  }
}

function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(major) || major < 24) {
    console.error(`[toupiao] 需要 Node.js 24 或更高版本，当前为 ${process.version}`);
    process.exit(1);
  }

  loadEnvFile();

  let config;
  try {
    config = loadConfig(process.env, { rootDir: process.cwd() });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[config] ${error.message}`);
      console.error('[config] 请检查 .env（可参考 .env.example），缺少关键配置时服务不会启动。');
      process.exit(1);
    }
    throw error;
  }

  let store;
  try {
    store = createStore({ dataDir: config.dataDir, logger: console });
  } catch (error) {
    if (error instanceof DatabaseError) {
      console.error(`[db] ${error.message}`);
      console.error('[db] 请检查 DATA_DIR 是否存在、是否可写；服务不会静默改用内存数据库。');
      process.exit(1);
    }
    throw error;
  }

  const scan = scanIcons(config.iconsDir, { logger: console });
  const iconStore = createIconStore(scan);
  const app = createApp({ config, store, iconStore, logger: console });

  const server = createServer((req, res) => {
    app.handler(req, res).catch((error) => {
      console.error('[http] 请求处理失败', error);
      if (res.writableEnded) return;
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: '服务器内部错误' }));
    });
  });

  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    else socket.destroy();
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[toupiao] 端口 ${config.port} 已被占用，请修改 PORT 或释放端口。`);
    } else {
      console.error(`[toupiao] HTTP 服务启动失败：${error.message}`);
    }
    store.close();
    process.exit(1);
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[toupiao] Node ${process.version}，数据库：${store.file}`);
    console.log(`[toupiao] 图标：${iconStore.icons.length} 个（${config.iconsDir}）`);
    if (!iconStore.available) {
      console.warn('[toupiao] 警告：图标目录缺失或没有 NN_名称.png，前台将显示空状态');
    }
    const dingtalk = resolveDingTalkSettings(store, config, { logger: console });
    if (!dingtalk.configured) {
      console.warn(
        '[toupiao] 钉钉登录尚未配置：请用管理员登录 /admin，在「钉钉登录」面板填写站点地址、AppKey 与 AppSecret。',
      );
    }
    const publicBaseUrl = dingtalk.publicBaseUrl || config.publicBaseUrl;
    console.log(`[toupiao] 监听 http://localhost:${config.port}（对外地址 ${publicBaseUrl}）`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[toupiao] 收到 ${signal}，正在关闭…`);
    const force = setTimeout(() => {
      console.error('[toupiao] 关闭超时，强制退出');
      store.close();
      process.exit(1);
    }, 5000);
    force.unref();
    server.close(() => {
      clearTimeout(force);
      store.close();
      console.log('[toupiao] 已退出');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => {
    console.error('[toupiao] 未处理的 Promise 拒绝：', error);
  });
}

main();

'use strict';

/**
 * 服务入口：HTTP 服务、路由分发、启动自检（F11）。
 *
 * 用 Node 内置 `http`，不引入任何 Web 框架 —— 接口一共就十来个，
 * 分发逻辑全部写在下面这个文件里，读完就能知道整个后端的形状。
 */

const http = require('http');

const { config, loadPassages } = require('./config');
const { Store } = require('./store');
const { detectFfmpeg, FfmpegUnavailableError } = require('./transcode');
const { HttpError, sendError } = require('./http-util');

const { createConfigRoutes } = require('./routes/config');
const { createEmployeeRoutes } = require('./routes/employee');
const { createAdminRoutes } = require('./routes/admin');
const { createStaticRoutes } = require('./routes/static');

// ---------------------------------------------------------------- 日志

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const log = {
  info: (message) => console.log(`[${timestamp()}] ${message}`),
  warn: (message) => console.warn(`[${timestamp()} 警告] ${message}`),
  error: (message) => console.error(`[${timestamp()} 错误] ${message}`),
};

// ---------------------------------------------------------------- 路由

function buildRouter(ctx) {
  const configRoutes = createConfigRoutes(ctx);
  const employeeRoutes = createEmployeeRoutes(ctx);
  const adminRoutes = createAdminRoutes(ctx);
  const staticRoutes = createStaticRoutes(ctx);

  const audioPattern = /^\/api\/admin\/audio\/([^/]+)\/([^/]+)$/;
  const downloadPattern = /^\/api\/admin\/download\/([^/]+)\/([^/]+)$/;

  function decodeParam(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return async function route(req, res, pathname) {
    const method = req.method === 'HEAD' ? 'HEAD' : req.method;

    // ---- F1 公开配置 ----
    if (pathname === '/api/config') {
      if (method !== 'GET') return sendError(res, 405, '只支持 GET');
      return configRoutes.getConfig(req, res);
    }

    // ---- F2 员工端口令 ----
    if (pathname === '/api/employee/access') {
      if (method !== 'POST') return sendError(res, 405, '只支持 POST');
      return employeeRoutes.postAccess(req, res);
    }

    // ---- F4 提交录音 ----
    if (pathname === '/api/submit') {
      if (method !== 'POST') return sendError(res, 405, '只支持 POST');
      return employeeRoutes.postSubmit(req, res);
    }

    // ---- F5 管理端登录 / 登出 / 会话 ----
    if (pathname === '/api/admin/login') {
      if (method !== 'POST') return sendError(res, 405, '只支持 POST');
      return adminRoutes.login(req, res);
    }
    if (pathname === '/api/admin/logout') {
      if (method !== 'POST') return sendError(res, 405, '只支持 POST');
      return adminRoutes.logout(req, res);
    }
    if (pathname === '/api/admin/session') {
      if (method !== 'GET') return sendError(res, 405, '只支持 GET');
      return adminRoutes.session(req, res);
    }

    // ---- F6 提交列表 ----
    if (pathname === '/api/admin/submissions') {
      if (method !== 'GET') return sendError(res, 405, '只支持 GET');
      return adminRoutes.listSubmissions(req, res);
    }

    // ---- F7 试听 / F8 下载 ----
    const audioMatch = audioPattern.exec(pathname);
    if (audioMatch) {
      if (method !== 'GET' && method !== 'HEAD') return sendError(res, 405, '只支持 GET');
      return adminRoutes.getAudio(req, res, decodeParam(audioMatch[1]), decodeParam(audioMatch[2]));
    }

    const downloadMatch = downloadPattern.exec(pathname);
    if (downloadMatch) {
      if (method !== 'GET' && method !== 'HEAD') return sendError(res, 405, '只支持 GET');
      return adminRoutes.downloadAudio(
        req,
        res,
        decodeParam(downloadMatch[1]),
        decodeParam(downloadMatch[2])
      );
    }

    // ---- 其它 /api/* 一律 404 JSON ----
    if (pathname.startsWith('/api/')) {
      return sendError(res, 404, '接口不存在');
    }

    // ---- F3 静态页面 ----
    if (method !== 'GET' && method !== 'HEAD') {
      return sendError(res, 405, '只支持 GET');
    }
    return staticRoutes.serve(req, res, pathname);
  };
}

// ---------------------------------------------------------------- 启动

function printStartupBanner() {
  const baseUrl = `http://localhost:${config.port}`;
  log.info('录音收集服务已启动');
  log.info(`监听地址    : ${baseUrl}`);
  log.info(`员工端      : ${baseUrl}/`);
  log.info(`管理端      : ${baseUrl}/admin.html`);
  log.info(`数据目录    : ${config.dataDir}`);
  log.info(`音频规格    : 单声道 / ${config.sampleRate} Hz / 16-bit PCM WAV`);
  log.info(`单文件上限  : ${config.maxUploadMb} MB`);
  if (config.adminCode === config.defaultAdminCode) {
    log.warn('──────────────────────────────────────────────────────────');
    log.warn('  安全警告：ADMIN_CODE 仍是默认值 admin123！');
    log.warn('  任何知道这个值的人都能查看、下载全部录音。');
    log.warn('  上线前必须改成自己的口令，例如：');
    log.warn("      ADMIN_CODE='你的新口令' npm start");
    log.warn('──────────────────────────────────────────────────────────');
  }
}

function fatal(message) {
  console.error('');
  console.error(`启动失败：${message}`);
  console.error('');
  process.exit(1);
}

async function main() {
  let passages;
  try {
    passages = loadPassages();
  } catch (err) {
    fatal(err.message);
    return;
  }

  // F11-1：启动就检测 ffmpeg，不可用直接退出，不要等转码时才报错
  try {
    const version = await detectFfmpeg(config.ffmpegPath);
    log.info(`ffmpeg 检测通过：${version}`);
  } catch (err) {
    if (err instanceof FfmpegUnavailableError) {
      fatal(err.message);
      return;
    }
    fatal(err.message);
    return;
  }

  // 数据目录准备 + 索引载入，失败同样在启动阶段就报错
  const store = new Store(config);
  try {
    await store.init();
  } catch (err) {
    fatal(err.message);
    return;
  }

  const ctx = { config, passages, store, log };
  const route = buildRouter(ctx);

  const server = http.createServer((req, res) => {
    let pathname = '/';
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      pathname = url.pathname;
    } catch {
      sendError(res, 400, '非法的请求地址');
      return;
    }

    Promise.resolve(route(req, res, pathname)).catch((err) => {
      if (err instanceof HttpError) {
        if (!res.headersSent) sendError(res, err.statusCode, err.message);
        return;
      }
      log.error(`处理 ${req.method} ${pathname} 时出错：${err && err.stack ? err.stack : err}`);
      if (!res.headersSent) {
        sendError(res, 500, '服务器内部错误');
      } else {
        res.destroy();
      }
    });
  });

  // 客户端提前断开（例如上传中途关掉页面）不应把进程弄崩
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.requestTimeout = 10 * 60 * 1000;
  server.headersTimeout = 60 * 1000;

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      fatal(`端口 ${config.port} 已被占用。换一个端口：PORT=3001 npm start`);
      return;
    }
    fatal(err.message);
  });

  server.listen(config.port, () => {
    printStartupBanner();
  });

  const shutdown = (signal) => {
    log.info(`收到 ${signal}，正在关闭服务……`);
    server.close(() => process.exit(0));
    // 兜底：连接迟迟不结束时也不要卡住进程
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  fatal(err && err.stack ? err.stack : String(err));
});
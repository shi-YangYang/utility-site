import { existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  HttpError,
  applySecurityHeaders,
  sendError,
  sendText,
  isAllowedOrigin,
  serveFile,
} from './http.js';
import { serveIcon } from './icons.js';
import { createRateLimiter } from './rate-limit.js';
import * as publicRoutes from './routes/public.js';
import * as authRoutes from './routes/auth.js';
import * as voteRoutes from './routes/votes.js';
import * as adminRoutes from './routes/admin.js';

const STATIC_ROUTES = {
  '/api/health': { GET: publicRoutes.health },
  '/api/state': { GET: publicRoutes.state },
  '/api/auth/login': { GET: authRoutes.login },
  '/api/auth/callback': { GET: authRoutes.callback },
  '/api/auth/logout': { POST: authRoutes.logout },
  '/api/admin/login': { POST: adminRoutes.login },
  '/api/admin/logout': { POST: adminRoutes.logout },
  '/api/admin/state': { GET: adminRoutes.state },
  '/api/admin/voters': { GET: adminRoutes.voters },
  '/api/admin/settings': { PUT: adminRoutes.settings },
  '/api/admin/icons': { POST: adminRoutes.uploadIcon },
  '/api/admin/dingtalk': { GET: adminRoutes.getDingtalk, PUT: adminRoutes.updateDingtalk },
  '/api/admin/reset': { POST: adminRoutes.reset },
  '/api/admin/export.csv': { GET: adminRoutes.exportCsv },
};

const VOTES_PATTERN = /^\/api\/votes\/([^/]+)$/;

function allowedMethods(route) {
  return Object.keys(route).join(', ');
}

/**
 * 建立请求处理器。依赖注入 store / iconStore / fetchImpl 便于测试，
 * 生产入口见 index.js。
 */
export function createApp({
  config,
  store,
  iconStore,
  fetchImpl = globalThis.fetch,
  logger = console,
}) {
  const loginLimiter = createRateLimiter({
    windowMs: config.adminLoginWindowMs,
    max: config.adminLoginMaxFailures,
  });

  async function serveSpa(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许', { Allow: 'GET, HEAD' });
    }
    const dist = resolve(config.clientDir);
    const indexPath = join(dist, 'index.html');
    if (!existsSync(indexPath)) {
      sendText(
        res,
        503,
        '<!doctype html><meta charset="utf-8"><title>toupiao</title>' +
          '<p>前端尚未构建。开发环境请运行 <code>npm run dev</code> 并访问 Vite 地址；' +
          '生产环境请先运行 <code>npm run build</code>。</p>',
        'text/html; charset=utf-8',
      );
      return;
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, 'BAD_PATH', '请求路径不合法');
    }
    const relative = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
    const candidate = resolve(dist, relative);
    if (candidate !== dist && !candidate.startsWith(`${dist}${sep}`)) {
      throw new HttpError(404, 'NOT_FOUND', '页面不存在');
    }

    if (candidate !== dist && existsSync(candidate) && statSync(candidate).isFile()) {
      const immutable = decodedPath.startsWith('/assets/');
      await serveFile(req, res, candidate, {
        cacheControl: immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      return;
    }

    const looksLikeAsset = /\.[A-Za-z0-9]+$/.test(decodedPath);
    if (looksLikeAsset) {
      throw new HttpError(404, 'NOT_FOUND', '文件不存在');
    }
    await serveFile(req, res, indexPath, { cacheControl: 'no-cache' });
  }

  async function handler(req, res) {
    const startedAt = Date.now();
    let pathname = (req.url ?? '/').split('?')[0];
    try {
      applySecurityHeaders(res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          Allow: 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD' && !isAllowedOrigin(req, config)) {
        throw new HttpError(403, 'ORIGIN_FORBIDDEN', '请求来源不被允许');
      }

      let url;
      try {
        url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
      } catch {
        throw new HttpError(400, 'BAD_REQUEST', '请求地址不合法');
      }
      pathname = url.pathname;

      if (pathname.startsWith('/icons/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许', { Allow: 'GET, HEAD' });
        }
        await serveIcon(req, res, pathname.slice('/icons/'.length), iconStore);
        return;
      }

      const route = STATIC_ROUTES[pathname];
      if (route) {
        const fn = route[req.method];
        if (!fn) {
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许', {
            Allow: `${allowedMethods(route)}, OPTIONS`,
          });
        }
        await fn({
          req,
          res,
          url,
          params: {},
          config,
          store,
          iconStore,
          fetchImpl,
          logger,
          loginLimiter,
        });
        return;
      }

      const voteMatch = VOTES_PATTERN.exec(pathname);
      if (voteMatch) {
        const fn = req.method === 'PUT' ? voteRoutes.add : req.method === 'DELETE' ? voteRoutes.remove : null;
        if (!fn) {
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被允许', {
            Allow: 'PUT, DELETE, OPTIONS',
          });
        }
        await fn({
          req,
          res,
          url,
          params: { iconId: voteMatch[1] },
          config,
          store,
          iconStore,
          fetchImpl,
          logger,
          loginLimiter,
        });
        return;
      }

      if (pathname === '/api' || pathname.startsWith('/api/')) {
        throw new HttpError(404, 'NOT_FOUND', '接口不存在');
      }

      await serveSpa(req, res, pathname);
    } catch (error) {
      if (!res.writableEnded && !res.destroyed) {
        if (error instanceof HttpError) {
          sendError(res, error.status, error.code, error.message, error.headers);
        } else if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
          /* 客户端提前断开，无需响应 */
        } else {
          logger.error?.('[http] 未处理的服务器错误', error);
          sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误，请稍后重试');
        }
      }
    } finally {
      logger.info?.(`[http] ${req.method} ${pathname} ${res.statusCode} ${Date.now() - startedAt}ms`);
    }
  }

  return { handler, loginLimiter };
}

'use strict';

/**
 * F3 静态页面服务。
 *
 * 只暴露 public/ 目录，且只暴露白名单内的文件类型。
 * server/ 下的源码、content/ 下的文稿都不在 public/ 里，因此不可能被下载到。
 * 路径拼接后必须复核落点仍在 public/ 内，杜绝 ../ 穿越。
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { sendText } = require('../http-util');
const { isInsideDir } = require('../sanitize');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function notFound(res) {
  sendText(
    res,
    404,
    '页面不存在（404）\n\n可用的入口：\n  /            员工端\n  /admin.html  管理端\n',
    'text/plain; charset=utf-8'
  );
}

function createStaticRoutes(ctx) {
  const { config } = ctx;

  return {
    /**
     * 处理 GET / 与 /admin.html 以及 public/ 下的静态资源。
     * @param {string} pathname URL 的 pathname（可能含百分号编码）
     */
    async serve(req, res, pathname) {
      let decoded;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        sendText(res, 400, '非法的请求路径（400）');
        return;
      }

      // NUL 字节是很多路径穿越技巧的原料，直接拒绝
      if (decoded.indexOf(String.fromCharCode(0)) !== -1) {
        sendText(res, 400, '非法的请求路径（400）');
        return;
      }

      let relative = decoded.replace(/^\/+/, '');
      if (relative === '') relative = 'index.html';

      const target = path.resolve(config.publicDir, relative);
      if (!isInsideDir(config.publicDir, target)) {
        notFound(res);
        return;
      }

      const extension = path.extname(target).toLowerCase();
      const contentType = MIME_TYPES[extension];
      if (!contentType) {
        // 不在白名单里的类型（例如 .md、.map）一律不提供
        notFound(res);
        return;
      }

      let stat;
      try {
        stat = await fsp.stat(target);
      } catch {
        notFound(res);
        return;
      }
      if (!stat.isFile()) {
        notFound(res);
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        // 页面是内部工具，不要被浏览器缓存住旧版本
        'Cache-Control': 'no-cache',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(target);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    },
  };
}

module.exports = { createStaticRoutes, MIME_TYPES };
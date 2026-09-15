'use strict';

/**
 * F1 公开配置接口。
 *
 * GET /api/config 返回前端渲染所需的全部公开配置。
 * **这里绝不能出现任何口令** —— 响应字段是逐个显式挑出来的，
 * 不是把 config 对象整体丢出去，避免将来加了配置项就顺手泄露。
 */

const { sendJson } = require('../http-util');

function createConfigRoutes(ctx) {
  const { passages, config } = ctx;

  return {
    // GET /api/config
    getConfig(req, res) {
      sendJson(res, 200, {
        targetSeconds: passages.targetSeconds,
        minSeconds: passages.minSeconds,
        maxSeconds: passages.maxSeconds,
        maxUploadMb: config.maxUploadMb,
        segments: passages.segments.map((segment) => ({
          key: segment.key,
          label: segment.label,
          lang: segment.lang,
          text: segment.text,
        })),
      });
    },
  };
}

module.exports = { createConfigRoutes };
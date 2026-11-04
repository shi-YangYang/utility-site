import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpError, serveFile } from './http.js';

/** 只接受 NN_名称.png；编号决定展示顺序。 */
export const ICON_FILE_PATTERN = /^(\d{2})_(.+)\.png$/;

/**
 * 启动时扫描图标目录。
 * 目录缺失或为空不崩溃，返回空列表 + available=false。
 * @returns {{ icons: Array<{id:string,name:string,file:string,url:string}>, available: boolean, dir: string }}
 */
export function scanIcons(dir, { logger = console } = {}) {
  if (!existsSync(dir)) {
    logger.warn?.(`[icons] 图标目录不存在：${dir}（前台将显示空状态，后台会给出警告）`);
    return { icons: [], available: false, dir };
  }

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    logger.warn?.(`[icons] 无法读取图标目录 ${dir}：${error.message}`);
    return { icons: [], available: false, dir };
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = ICON_FILE_PATTERN.exec(entry.name);
    if (!match) continue;
    candidates.push({
      id: match[1],
      name: match[2],
      file: entry.name,
    });
  }

  candidates.sort((a, b) => Number(a.id) - Number(b.id) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  const icons = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) {
      logger.warn?.(`[icons] 编号重复：${candidate.file} 与已有图标编号 ${candidate.id} 冲突，已保留第一个`);
      continue;
    }
    seen.add(candidate.id);
    icons.push({
      ...candidate,
      url: `/icons/${encodeURIComponent(candidate.file)}`,
    });
  }

  if (icons.length === 0) {
    logger.warn?.(`[icons] 目录中没有符合 NN_名称.png 的图标：${dir}`);
  }

  return { icons, available: icons.length > 0, dir };
}

/**
 * 基于启动扫描结果建立白名单，避免按请求路径拼接文件系统路径。
 */
export function createIconStore(scanResult) {
  const root = resolve(scanResult.dir);
  const byFile = new Map();
  const byId = new Map();
  for (const icon of scanResult.icons) {
    const path = resolve(root, icon.file);
    if (!path.startsWith(`${root}/`)) continue;
    byFile.set(icon.file, { ...icon, path });
    byId.set(icon.id, { ...icon, path });
  }
  return {
    dir: scanResult.dir,
    available: scanResult.available && byFile.size > 0,
    icons: [...byId.values()].map(({ path, ...icon }) => icon),
    getById(id) {
      return byId.get(id) ?? null;
    },
    getByName(name) {
      return byFile.get(name) ?? null;
    },
  };
}

/**
 * 只服务白名单中的图标文件；中文文件名按 URL 编码匹配。
 */
export async function serveIcon(req, res, rawName, iconStore) {
  let name;
  try {
    name = decodeURIComponent(rawName || '');
  } catch {
    throw new HttpError(404, 'ICON_NOT_FOUND', '图标不存在');
  }
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new HttpError(404, 'ICON_NOT_FOUND', '图标不存在');
  }
  const icon = iconStore.getByName(name);
  if (!icon) {
    throw new HttpError(404, 'ICON_NOT_FOUND', '图标不存在');
  }
  await serveFile(req, res, icon.path, {
    contentType: 'image/png',
    cacheControl: 'public, max-age=31536000, immutable',
  });
}

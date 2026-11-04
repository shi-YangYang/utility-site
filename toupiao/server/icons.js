import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { HttpError, serveFile } from './http.js';

/** 只接受 01–99 的 NN_名称.png；编号决定展示顺序。 */
export const ICON_FILE_PATTERN = /^(0[1-9]|[1-9]\d)_(.+)\.png$/;

/** 上传限制：单文件 5 MB，编号 01–99。 */
export const MAX_ICON_BYTES = 5 * 1024 * 1024;
export const MAX_ICON_ID = 99;
export const MAX_ICON_NAME_LENGTH = 40;

/** PNG 文件头 89 50 4E 47 0D 0A 1A 0A。 */
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function hasPngSignature(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}

/**
 * 完整 PNG 结构校验：签名 + IHDR（宽高 > 0）+ 至少一个 IDAT + IEND。
 * 允许 IEND 之后有尾随字节（部分导出工具会附加元数据），但拒绝只有签名/截断文件。
 */
export function isValidPng(buffer) {
  if (!hasPngSignature(buffer)) return false;
  let offset = 8;
  let sawIHDR = false;
  let sawIDAT = false;
  let sawIEND = false;
  let firstChunk = true;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const crcEnd = dataStart + length + 4;
    if (crcEnd > buffer.length) return false;

    if (firstChunk) {
      if (type !== 'IHDR' || length !== 13) return false;
      const width = buffer.readUInt32BE(dataStart);
      const height = buffer.readUInt32BE(dataStart + 4);
      if (width < 1 || height < 1) return false;
      sawIHDR = true;
      firstChunk = false;
    } else if (type === 'IHDR') {
      return false;
    }

    if (type === 'IDAT') sawIDAT = true;
    if (type === 'IEND') {
      if (length !== 0) return false;
      sawIEND = true;
      break;
    }
    offset = crcEnd;
  }

  return sawIHDR && sawIDAT && sawIEND;
}

/**
 * 把上传时的原始文件名清洗成展示名称：
 * 去掉目录、.png、可选 NN_ 前缀，移除路径分隔符/控制字符/..，截断到 40 字。
 * 清洗后为空时使用「新图标」。
 */
export function sanitizeIconName(raw) {
  let name = typeof raw === 'string' ? raw : '';
  // 同时兼容 / 与 \ 两种分隔符，只取最后一段。
  name = basename(name.replaceAll('\\', '/'));
  name = name.replace(/\.png$/i, '');
  name = name.replace(/^\d{2}_/, '');
  name = name.replace(/[\u0000-\u001f\u007f]/g, '');
  name = name.replace(/[\\/]/g, '');
  name = name.replaceAll('..', '');
  name = name.trim();
  if (!name || /^\.+$/.test(name)) return '新图标';
  const chars = Array.from(name);
  if (chars.length > MAX_ICON_NAME_LENGTH) {
    name = chars.slice(0, MAX_ICON_NAME_LENGTH).join('').trim();
  }
  return name || '新图标';
}

function usedIconIds(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw new HttpError(
      500,
      'ICONS_DIR_UNAVAILABLE',
      '无法读取图标目录，请检查 ICONS_DIR 与目录权限',
    );
  }
  const used = new Set();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = ICON_FILE_PATTERN.exec(entry.name);
    if (match) used.add(Number(match[1]));
  }
  return used;
}

/** 在 01–99 中取当前未使用的最小两位编号；已满返回 null。 */
export function allocateIconId(dir) {
  const used = usedIconIds(dir);
  // 总数也已到上限（目录里可能还存在 00_*.png 这类非分配编号）。
  if (used.size >= MAX_ICON_ID) return null;
  for (let id = 1; id <= MAX_ICON_ID; id += 1) {
    if (!used.has(id)) return String(id).padStart(2, '0');
  }
  return null;
}

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
 * 基于扫描结果建立白名单，避免按请求路径拼接文件系统路径。
 * reload() 重扫同一目录并原子替换内存中的图标列表，上传后无需重启。
 */
export function createIconStore(scanResult) {
  const root = resolve(scanResult.dir);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  let byFile = new Map();
  let byId = new Map();

  function apply(scan) {
    const nextByFile = new Map();
    const nextById = new Map();
    for (const icon of scan.icons) {
      const path = resolve(root, icon.file);
      if (!path.startsWith(rootPrefix)) continue;
      nextByFile.set(icon.file, { ...icon, path });
      nextById.set(icon.id, { ...icon, path });
    }
    byFile = nextByFile;
    byId = nextById;
    store.available = scan.available && nextByFile.size > 0;
    store.icons = [...nextById.values()].map(({ path, ...icon }) => icon);
  }

  const store = {
    dir: scanResult.dir,
    available: false,
    icons: [],
    getById(id) {
      return byId.get(id) ?? null;
    },
    getByName(name) {
      return byFile.get(name) ?? null;
    },
    /** 重扫同一目录；成功返回新的扫描结果。 */
    reload({ logger = console } = {}) {
      const scan = scanIcons(root, { logger });
      apply(scan);
      return scan;
    },
    /** 当前目录中的下一个最小空闲编号（01–99），没有空位返回 null。 */
    allocateId() {
      return allocateIconId(root);
    },
  };

  apply(scanResult);
  return store;
}

/** 模块级串行队列：所有上传的“分配编号 + 落盘”依次执行，避免并发撞号。 */
let uploadQueue = Promise.resolve();

function enqueueUpload(task) {
  const result = uploadQueue.then(task, task);
  uploadQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function saveError(error) {
  if (error instanceof HttpError) return error;
  const permissionDenied = ['EACCES', 'EPERM', 'EROFS', 'ENOSPC'].includes(error?.code);
  return new HttpError(
    500,
    'ICON_SAVE_FAILED',
    permissionDenied
      ? '保存图标失败：图标目录不可写，请检查 ICONS_DIR 与目录权限'
      : '保存图标失败，请检查图标目录权限',
  );
}

/**
 * 校验并保存一个上传的 PNG，返回新的图标对象。
 * 编号取当前未使用的最小值；临时文件写完再 rename，失败清理临时文件。
 */
export function saveUploadedIcon({ dir, buffer, originalName = '', logger = console }) {
  return enqueueUpload(async () => {
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
    if (data.length === 0) {
      throw new HttpError(400, 'INVALID_IMAGE', '请选择要上传的 PNG 图片');
    }
    if (data.length > MAX_ICON_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '图片不能超过 5 MB');
    }
    if (!isValidPng(data)) {
      throw new HttpError(400, 'INVALID_IMAGE', '仅支持完整有效的 PNG 图片');
    }

    const name = sanitizeIconName(originalName);
    if (typeof dir !== 'string' || !dir.trim()) {
      throw new HttpError(500, 'ICONS_DIR_UNAVAILABLE', '未配置图标目录 ICONS_DIR');
    }
    const root = resolve(dir);
    const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;

    try {
      await mkdir(root, { recursive: true });
    } catch (error) {
      logger.error?.(`[icons] 无法创建图标目录 ${root}：${error.message}`);
      throw new HttpError(
        500,
        'ICONS_DIR_UNAVAILABLE',
        '无法创建图标目录，请检查 ICONS_DIR 与目录权限',
      );
    }

    const id = allocateIconId(root);
    if (!id) {
      throw new HttpError(409, 'ICON_LIMIT_REACHED', '候选图标已达上限（99 张）');
    }

    const fileName = `${id}_${name}.png`;
    const finalPath = resolve(root, fileName);
    // sanitizeIconName 已移除分隔符与 ..，这里再做一次目录边界兜底。
    if (!finalPath.startsWith(rootPrefix)) {
      throw new HttpError(400, 'INVALID_FILENAME', '文件名不合法，请重命名后重试');
    }

    const tempPath = resolve(root, `.upload-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
    try {
      await writeFile(tempPath, data, { flag: 'wx' });
      await rename(tempPath, finalPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      logger.error?.(`[icons] 保存 ${fileName} 失败：${error.code || error.message}`);
      throw saveError(error);
    }

    logger.info?.(`[icons] 已保存上传图标 ${fileName}`);
    return {
      id,
      name,
      file: fileName,
      url: `/icons/${encodeURIComponent(fileName)}`,
    };
  });
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

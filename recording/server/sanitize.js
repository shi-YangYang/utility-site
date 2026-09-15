'use strict';

/**
 * 姓名消毒与目录名生成 —— 纯函数。
 *
 * 员工姓名完全来自用户输入，是不可信数据。任何把它用作文件路径的地方
 * 都必须先经过本模块，确保结果只能是一个「普通目录名」：
 * 不含路径分隔符、不含 `..`、不含控制字符、不以点开头、长度有限。
 *
 * 同时负责在消毒后撞车时给出确定性的替代目录名（追加短 hash）。
 */

const crypto = require('crypto');
const path = require('path');

/** 目录名最大长度（按 Unicode 码点计，避免把 emoji / 中文切成半个字符）。 */
const MAX_DIR_LENGTH = 48;
/** 追加 hash 后缀后的绝对上限。 */
const MAX_DIR_LENGTH_WITH_SUFFIX = 64;
/** 原始姓名允许的最大长度，超过视为异常输入（由调用方转成 400）。 */
const MAX_RAW_NAME_LENGTH = 120;

/** 控制字符：C0 区、DEL、C1 区。 */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g');
/** 首尾的空白与全角空格。 */
const EDGE_SPACES = new RegExp('^[\\s\\u3000]+|[\\s\\u3000]+$', 'g');
/** 前导的点（半角句点与全角句点）。 */
const LEADING_DOTS = new RegExp('^[.\\uFF0E]+');
/** 检测用（不带 g 标志，避免 test() 的 lastIndex 副作用）。 */
const HAS_CONTROL_CHAR = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]');

/**
 * 消毒：把任意字符串压成一个可用于单个目录名的字符串。
 * 处理顺序有讲究：先去控制字符与分隔符，再去 `..`，最后才处理首尾点与空白。
 */
function sanitizeName(rawName) {
  let name = typeof rawName === 'string' ? rawName : String(rawName == null ? '' : rawName);

  // 1. 控制字符（含 NUL、换行、DEL 以及 C1 控制区）一律去掉
  name = name.replace(CONTROL_CHARS, '');

  // 2. 路径分隔符，以及 Windows 上的保留字符
  name = name.replace(/[/\\:*?"<>|]/g, '');

  // 3. 任意位置的 `..` 序列（两连点及以上）——必须在去分隔符之后做，
  //    这样 `../../evil` 先去斜杠变成 `....evil`，再被此处清成 `evil`
  name = name.replace(/\.{2,}/g, '');

  // 4. 收掉首尾空白
  name = name.replace(EDGE_SPACES, '');

  // 5. 前导点 —— 避免产生 `.` / `..` / 隐藏目录
  name = name.replace(LEADING_DOTS, '');
  name = name.replace(EDGE_SPACES, '');

  // 6. Windows 设备保留名（CON、PRN、AUX、NUL、COM1-9、LPT1-9）
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) {
    name = `_${name}`;
  }

  // 7. 限制长度
  name = Array.from(name).slice(0, MAX_DIR_LENGTH).join('');

  // 8. 截断后可能又留下首尾的点或空白，再清一次
  name = name.replace(LEADING_DOTS, '').replace(EDGE_SPACES, '');

  return name;
}

/** 取原始姓名的 SHA-256 前 N 位十六进制，用于回退目录名与撞车后缀。 */
function shortHash(rawName, length = 8) {
  return crypto
    .createHash('sha256')
    .update(String(rawName == null ? '' : rawName), 'utf8')
    .digest('hex')
    .slice(0, length);
}

/**
 * 消毒后不可用（空串）时的回退目录名：基于原始姓名 hash，稳定且与原始输入一一对应。
 * 前缀 `u-` 让它一眼能看出是 hash 回退，不会和正常姓名混淆。
 */
function hashName(rawName) {
  return `u-${shortHash(rawName, 16)}`;
}

/** 消毒后的基础目录名；不可用时回退到 hash。 */
function baseDirName(rawName) {
  const cleaned = sanitizeName(rawName);
  return cleaned || hashName(rawName);
}

/**
 * 分配最终目录名。
 * @param {string} rawName 原始姓名
 * @param {Set<string>} takenDirs 已被**其他**员工占用的目录名集合
 * @returns {string} 最终目录名，保证不在 takenDirs 中，且长度受限
 */
function allocateDirName(rawName, takenDirs) {
  const taken = takenDirs instanceof Set ? takenDirs : new Set(takenDirs || []);
  const base = baseDirName(rawName);
  if (!taken.has(base)) return base;

  // 消毒后撞车：追加基于原始姓名的短 hash，保证确定性且与原始姓名绑定
  const suffix = shortHash(rawName, 6);
  let candidate = `${base}-${suffix}`;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}-${counter}`;
    counter += 1;
  }

  // 极长姓名 + 后缀仍要保证不超过上限
  const chars = Array.from(candidate);
  if (chars.length > MAX_DIR_LENGTH_WITH_SUFFIX) {
    return `${chars.slice(0, MAX_DIR_LENGTH_WITH_SUFFIX - suffix.length - 1).join('')}-${suffix}`;
  }
  return candidate;
}

/**
 * 判断一个字符串能否安全地当作单个路径片段使用（纵深防御，用于校验索引里读出的 id）。
 * 只允许普通字符，禁止分隔符、`.`、`..`、控制字符、前导点。
 */
function isSafeSegment(segment) {
  if (typeof segment !== 'string' || segment === '') return false;
  if (segment === '.' || segment === '..') return false;
  if (HAS_CONTROL_CHAR.test(segment)) return false;
  if (/[/\\]/.test(segment)) return false;
  if (segment.startsWith('.')) return false;
  if (Array.from(segment).length > MAX_DIR_LENGTH_WITH_SUFFIX) return false;
  return true;
}

/**
 * 判断 target 是否严格位于 baseDir 之内（含纵深防御，防止拼接出的路径逃逸）。
 * 用于落盘前最后一道校验：结果必须始终在 DATA_DIR/recordings/ 内。
 */
function isInsideDir(baseDir, target) {
  const base = path.resolve(baseDir);
  const full = path.resolve(target);
  if (full === base) return false;
  const rel = path.relative(base, full);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = {
  MAX_DIR_LENGTH,
  MAX_RAW_NAME_LENGTH,
  sanitizeName,
  shortHash,
  hashName,
  baseDirName,
  allocateDirName,
  isSafeSegment,
  isInsideDir,
};
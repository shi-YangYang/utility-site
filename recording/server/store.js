'use strict';

/**
 * 员工索引与录音文件的存储层。
 *
 * 两条硬规则（见 constitution/tech-stack.md「数据存储」）：
 *   1. 索引写入必须**原子** —— 先写临时文件，fsync 后 rename 覆盖，绝不原地改写；
 *   2. 并发提交必须**串行化** —— 所有涉及索引的写操作都排在同一条 Promise 链上，
 *      避免两个人同时提交时互相覆盖、把索引写坏。
 *
 * 落盘顺序也固定为：先转码产物就位 → 校验通过 → 最后才更新索引。
 * 索引里因此不会出现指向不存在文件的记录。
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { allocateDirName, isSafeSegment, isInsideDir } = require('./sanitize');

/** 录音段落固定为 zh / en 两段，与 content/passages.json 的 key 一致。 */
const SEGMENT_KEYS = ['zh', 'en'];

class StoreError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StoreError';
    this.cause = cause;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function randomSuffix() {
  return crypto.randomBytes(6).toString('hex');
}

class Store {
  constructor(config) {
    this.config = config;
    /** 内存中的索引，加载后即为权威副本（同一时刻只有一个进程写它）。 */
    this.index = { version: config.indexVersion, employees: [] };
    /** 写锁：串行化所有索引写操作。 */
    this._chain = Promise.resolve();
  }

  // ---------------------------------------------------------------- 锁

  /**
   * 把 fn 排进写队列，保证不会有两个写操作同时在跑。
   * 前一个任务失败不会卡死后面的任务。
   */
  withLock(fn) {
    const result = this._chain.then(() => fn());
    this._chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  // ---------------------------------------------------------------- 启动

  /**
   * 准备数据目录并载入索引。任何失败都在启动阶段抛出，不放到请求处理里。
   */
  async init() {
    const { dataDir, recordingsDir, tmpDir } = this.config;

    try {
      await fsp.mkdir(dataDir, { recursive: true });
      await fsp.mkdir(recordingsDir, { recursive: true });
      await fsp.mkdir(tmpDir, { recursive: true });
    } catch (err) {
      throw new StoreError(`无法创建数据目录 ${dataDir}：${err.message}`, err);
    }

    // 写权限探测：宁可启动失败，也不要等到有人提交录音才发现写不进去
    const probeFile = path.join(dataDir, '.write-probe');
    try {
      await fsp.writeFile(probeFile, 'ok', 'utf8');
    } catch (err) {
      throw new StoreError(
        [
          `数据目录不可写：${dataDir}`,
          `原因：${err.message}`,
          '请检查目录权限，或用环境变量 DATA_DIR 指定一个可写的目录。',
        ].join('\n'),
        err
      );
    }

    // 能写但不能删（例如某些只读挂载 / 受限文件系统）：临时文件将无法自动清理。
    // 这不影响正确性（索引靠 rename 原子替换，不需要删除），所以只告警不拦服务。
    try {
      await fsp.unlink(probeFile);
    } catch (err) {
      this.canDeleteFiles = false;
      console.warn(
        `[存储] 警告：数据目录 ${dataDir} 可写但不可删除文件（${err.code}）。` +
          '上传的临时文件不会被自动清理，请留意该目录的磁盘占用。'
      );
    }

    // 清掉上次运行可能残留的临时文件（此刻不可能有正在处理的请求，清空是安全的）
    await this._clearTmpDir();

    await this._loadIndex();
    return this;
  }

  async _clearTmpDir() {
    const { tmpDir } = this.config;
    let entries = [];
    try {
      entries = await fsp.readdir(tmpDir);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw new StoreError(`无法读取临时目录 ${tmpDir}：${err.message}`, err);
    }
    for (const entry of entries) {
      try {
        await fsp.rm(path.join(tmpDir, entry), { recursive: true, force: true });
      } catch (err) {
        console.warn(`[存储] 清理残留临时文件失败（忽略）：${entry} —— ${err.message}`);
      }
    }
  }

  async _loadIndex() {
    const { indexPath } = this.config;

    let raw = null;
    try {
      raw = await fsp.readFile(indexPath, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw new StoreError(`无法读取索引文件 ${indexPath}：${err.message}`, err);
      }
      // 首次启动：建立空索引
      this.index = { version: this.config.indexVersion, employees: [] };
      await this.withLock(() => this._writeIndexAtomic());
      return;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(
        `[存储] 索引文件不是合法 JSON（${err.message}），尝试从 recordings/ 下的 meta.json 重建……`
      );
    }

    const employees = parsed && Array.isArray(parsed.employees) ? parsed.employees : null;
    if (!employees) {
      const rebuilt = await this._rebuildFromDisk();
      this.index = { version: this.config.indexVersion, employees: rebuilt };
      console.warn(`[存储] 索引已重建，恢复出 ${rebuilt.length} 条记录。`);
      await this.withLock(() => this._writeIndexAtomic());
      return;
    }

    // 纵深防御：索引里读出的 dir 也必须能安全当路径片段用
    const safe = employees.filter((e) => e && typeof e.name === 'string' && isSafeSegment(e.dir));
    if (safe.length !== employees.length) {
      console.warn(
        `[存储] 索引中有 ${employees.length - safe.length} 条记录的目录名不安全，已跳过。`
      );
    }

    this.index = {
      version: Number(parsed.version) || this.config.indexVersion,
      employees: safe,
    };
  }

  /** 索引损坏时的兜底：扫 recordings/<dir>/meta.json 把记录捞回来。 */
  async _rebuildFromDisk() {
    const { recordingsDir } = this.config;
    let dirs = [];
    try {
      dirs = await fsp.readdir(recordingsDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw new StoreError(`无法读取录音目录 ${recordingsDir}：${err.message}`, err);
    }

    const rebuilt = [];
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      try {
        const metaRaw = await fsp.readFile(
          path.join(recordingsDir, dir.name, 'meta.json'),
          'utf8'
        );
        const meta = JSON.parse(metaRaw);
        if (meta && typeof meta.name === 'string' && isSafeSegment(meta.dir || dir.name)) {
          rebuilt.push({ ...meta, dir: meta.dir || dir.name, id: meta.id || meta.dir || dir.name });
        }
      } catch {
        // 这个目录没有可用的 meta.json，跳过
      }
    }
    return rebuilt;
  }

  // ---------------------------------------------------------------- 读

  /** 返回索引里所有员工记录的浅拷贝数组（调用方只读）。 */
  listEmployees() {
    return this.index.employees.map((e) => ({ ...e }));
  }

  /** 按对外 id 查一条记录。id 只当作索引里的键，不参与路径拼接。 */
  findById(id) {
    if (typeof id !== 'string' || id === '') return null;
    const found = this.index.employees.find((e) => e.id === id);
    return found ? { ...found } : null;
  }

  /** 按原始姓名（去首尾空白后）查一条记录 —— 姓名是逻辑主键。 */
  findByName(name) {
    const found = this.index.employees.find((e) => e.name === name);
    return found ? { ...found } : null;
  }

  /** 员工录音所在目录的绝对路径，并校验它确实落在 DATA_DIR/recordings/ 内。 */
  resolveEmployeeDir(record) {
    if (!record || !isSafeSegment(record.dir)) {
      throw new StoreError(`非法的员工目录名：${record && record.dir}`);
    }
    const dirPath = path.resolve(this.config.recordingsDir, record.dir);
    if (!isInsideDir(this.config.recordingsDir, dirPath)) {
      throw new StoreError(`员工目录越界：${dirPath}`);
    }
    return dirPath;
  }

  /** 某个段落文件的绝对路径，同样做落点校验。 */
  resolveSegmentFile(record, segmentKey) {
    if (!SEGMENT_KEYS.includes(segmentKey)) {
      throw new StoreError(`未知的录音段落：${segmentKey}`);
    }
    const dirPath = this.resolveEmployeeDir(record);
    const filePath = path.resolve(dirPath, `${segmentKey}.wav`);
    if (!isInsideDir(this.config.recordingsDir, filePath)) {
      throw new StoreError(`录音文件越界：${filePath}`);
    }
    return filePath;
  }

  // ---------------------------------------------------------------- 写

  /**
   * 提交一条录音记录（同名覆盖）。
   *
   * @param {object} params
   * @param {string} params.name      原始姓名（已去首尾空白），逻辑主键
   * @param {object} params.segments  形如 { zh: {tempPath, durationSec, bytes, sampleRate, channels}, en: {...} }
   *                                  tempPath 必须是已经转码并校验过的 WAV 临时文件
   * @returns {Promise<{employee: object, created: boolean}>}
   */
  async upsertEmployee({ name, segments }) {
    return this.withLock(() => this._upsertLocked({ name, segments }));
  }

  async _upsertLocked({ name, segments }) {
    for (const key of SEGMENT_KEYS) {
      const seg = segments && segments[key];
      if (!seg || !seg.tempPath) {
        throw new StoreError(`提交数据不完整：缺少 ${key} 段`);
      }
    }

    const existing = this.index.employees.find((e) => e.name === name);
    const created = !existing;

    let record;
    if (existing) {
      // 同名覆盖：沿用原来的 id / dir，保留 firstSubmittedAt
      record = existing;
    } else {
      const takenDirs = new Set(this.index.employees.map((e) => e.dir));
      const dir = allocateDirName(name, takenDirs);
      if (!isSafeSegment(dir)) {
        throw new StoreError(`姓名消毒后的目录名不可用：${dir}`);
      }
      const timestamp = nowIso();
      record = {
        id: dir,
        name,
        dir,
        firstSubmittedAt: timestamp,
        updatedAt: timestamp,
        segments: {},
      };
    }

    const dirPath = this.resolveEmployeeDir(record);
    const timestamp = nowIso();

    // 先算出新的 segments 元信息，再落文件
    const nextSegments = {};
    for (const key of SEGMENT_KEYS) {
      const seg = segments[key];
      nextSegments[key] = {
        file: `${key}.wav`,
        durationSec: Number(Number(seg.durationSec).toFixed(3)),
        bytes: Number(seg.bytes) || 0,
        sampleRate: Number(seg.sampleRate) || this.config.sampleRate,
        channels: Number(seg.channels) || 1,
      };
    }

    const previousSegments = existing ? existing.segments : null;
    const previousUpdatedAt = existing ? existing.updatedAt : null;

    await fsp.mkdir(dirPath, { recursive: true });

    // 逐段把临时文件搬到最终位置；旧文件先挪成 .bak，便于失败时回滚
    const moves = [];
    try {
      for (const key of SEGMENT_KEYS) {
        const from = segments[key].tempPath;
        const to = path.join(dirPath, `${key}.wav`);
        // 旧文件先复制一份到临时目录做保险，失败时可以还原。
        // 用 copyFile 而不是 rename：临时目录与录音目录理论上可能不在同一个文件系统上，
        // 跨设备 rename 会抛 EXDEV，复制则不怕。
        const backup = path.join(this.config.tmpDir, `backup-${key}-${randomSuffix()}.bak`);
        let hadBackup = false;

        try {
          await fsp.copyFile(to, backup);
          hadBackup = true;
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }

        await fsp.rename(from, to);
        moves.push({ to, backup, hadBackup });
      }
    } catch (err) {
      await this._rollbackMoves(moves);
      throw new StoreError(`写入录音文件失败：${err.message}`, err);
    }

    // 更新内存索引
    record.segments = nextSegments;
    record.updatedAt = timestamp;
    if (created) {
      this.index.employees.push(record);
    }

    try {
      // meta.json 是給人看的副本，写失败不影响正确性
      await this._writeMeta(dirPath, record).catch((err) => {
        console.warn(`[存储] 写 meta.json 失败（忽略）：${err.message}`);
      });
      // 索引写入是最后一步，且是原子的 —— 走到这里才对外可见
      await this._writeIndexAtomic();
    } catch (err) {
      // 索引没写成：把内存与磁盘都还原回去，不留下指向旧文件的错误记录
      if (created) {
        this.index.employees = this.index.employees.filter((e) => e !== record);
      } else {
        record.segments = previousSegments;
        record.updatedAt = previousUpdatedAt;
      }
      await this._rollbackMoves(moves);
      throw new StoreError(`更新索引失败：${err.message}`, err);
    }

    // 成功后清掉备份
    for (const move of moves) {
      if (!move.hadBackup) continue;
      await fsp.rm(move.backup, { force: true }).catch(() => {});
    }

    return { employee: { ...record }, created };
  }

  /** 回滚已经完成的文件搬运：有备份就还原旧内容，没有备份说明这个文件本来不该存在。 */
  async _rollbackMoves(moves) {
    for (const move of [...moves].reverse()) {
      if (move.hadBackup) {
        try {
          await fsp.copyFile(move.backup, move.to);
        } catch (err) {
          console.warn(`[存储] 回滚录音文件失败：${move.to} —— ${err.message}`);
        }
      } else {
        try {
          await fsp.rm(move.to, { force: true });
        } catch {
          /* 忽略 */
        }
      }
    }
  }

  async _writeMeta(dirPath, record) {
    const metaPath = path.join(dirPath, 'meta.json');
    await this._atomicWrite(metaPath, JSON.stringify(record, null, 2));
  }

  async _writeIndexAtomic() {
    const payload = JSON.stringify(this.index, null, 2);
    await this._atomicWrite(this.config.indexPath, payload);
  }

  /** 原子写：临时文件 → fsync → rename 覆盖。 */
  async _atomicWrite(targetPath, contents) {
    const dir = path.dirname(targetPath);
    const tmpPath = path.join(dir, `.${path.basename(targetPath)}.tmp-${process.pid}-${randomSuffix()}`);

    let handle = null;
    try {
      handle = await fsp.open(tmpPath, 'w');
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fsp.rename(tmpPath, targetPath);
    } catch (err) {
      if (handle) await handle.close().catch(() => {});
      await fsp.rm(tmpPath, { force: true }).catch(() => {});
      throw err;
    }

    // 尽力而为地同步目录项，让 rename 对断电也可见（部分平台不支持，失败忽略）
    try {
      const dirHandle = await fsp.open(dir, 'r');
      await dirHandle.sync();
      await dirHandle.close();
    } catch {
      /* 忽略 */
    }
  }

  /** 磁盘上录音段落的实际字节数，用于列表展示时以文件为准。 */
  statSegmentFile(record, segmentKey) {
    const filePath = this.resolveSegmentFile(record, segmentKey);
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile() ? stat.size : 0;
    } catch {
      return 0;
    }
  }
}

module.exports = { Store, StoreError, SEGMENT_KEYS };
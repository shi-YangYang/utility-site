import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** 数据库打开/迁移失败时抛出，携带明确文件路径。 */
export class DatabaseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseError';
  }
}

const MIGRATIONS = [
  function migrationV1(db) {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        union_id TEXT NOT NULL UNIQUE,
        nick TEXT NOT NULL,
        avatar_url TEXT,
        created_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL
      );

      CREATE TABLE votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        icon_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (user_id, icon_id)
      );

      CREATE INDEX idx_votes_icon ON votes(icon_id);
      CREATE INDEX idx_votes_user ON votes(user_id);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT INTO settings (key, value) VALUES ('voting_open', '1');
    `);
  },
];

function readSchemaVersion(db) {
  const row = db.prepare('PRAGMA user_version').get();
  return Number(row?.user_version ?? 0);
}

function migrate(db) {
  let version = readSchemaVersion(db);
  if (version > MIGRATIONS.length) {
    throw new DatabaseError(
      `数据库 schema 版本 ${version} 高于当前程序支持的 ${MIGRATIONS.length}，请升级程序`,
    );
  }
  while (version < MIGRATIONS.length) {
    const next = version + 1;
    db.exec('BEGIN IMMEDIATE');
    try {
      MIGRATIONS[version](db);
      db.exec(`PRAGMA user_version = ${next}`);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* 忽略回滚失败，保留原始错误 */
      }
      throw error;
    }
    version = next;
  }
}

export function openDatabase(dataDir) {
  let db;
  const file = join(dataDir, 'toupiao.db');
  try {
    mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(file);
  } catch (error) {
    throw new DatabaseError(`无法打开数据库 ${file}：${error.message}`);
  }
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    migrate(db);
  } catch (error) {
    try {
      db.close();
    } catch {
      /* 忽略关闭失败 */
    }
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(`初始化数据库 ${file} 失败：${error.message}`);
  }
  return { db, file };
}

export class Store {
  constructor({ dataDir, now = () => new Date(), logger = console }) {
    const { db, file } = openDatabase(dataDir);
    this.db = db;
    this.file = file;
    this.now = now;
    this.logger = logger;
  }

  nowIso() {
    const value = this.now();
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString();
  }

  close() {
    try {
      this.db.close();
    } catch (error) {
      this.logger.warn?.(`[db] 关闭数据库失败：${error.message}`);
    }
  }

  // ---------- 设置 ----------

  getSetting(key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  isVotingOpen() {
    return this.getSetting('voting_open') === '1';
  }

  setVotingOpen(open) {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('voting_open', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(open ? '1' : '0');
    return this.isVotingOpen();
  }

  // ---------- 用户 ----------

  getUserById(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
  }

  upsertUser({ unionId, nick, avatarUrl }) {
    const timestamp = this.nowIso();
    const existing = this.db.prepare('SELECT id FROM users WHERE union_id = ?').get(unionId);
    if (existing) {
      this.db
        .prepare('UPDATE users SET nick = ?, avatar_url = ?, last_login_at = ? WHERE id = ?')
        .run(nick, avatarUrl || null, timestamp, existing.id);
      return this.getUserById(existing.id);
    }
    const result = this.db
      .prepare(
        'INSERT INTO users (union_id, nick, avatar_url, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(unionId, nick, avatarUrl || null, timestamp, timestamp);
    return this.getUserById(Number(result.lastInsertRowid));
  }

  // ---------- 投票 ----------

  getVotesForUser(userId) {
    return this.db
      .prepare('SELECT icon_id, created_at FROM votes WHERE user_id = ? ORDER BY created_at ASC, id ASC')
      .all(userId);
  }

  countVotesForUser(userId) {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM votes WHERE user_id = ?').get(userId);
    return Number(row?.count ?? 0);
  }

  /**
   * 新增投票。投票关闭、已达上限、重复投票都在同一事务内判定，避免并发超投。
   * @returns {'added'|'exists'|'limit'|'closed'}
   */
  addVote({ userId, iconId, maxVotes = 5 }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.isVotingOpen()) {
        this.db.exec('COMMIT');
        return 'closed';
      }
      const existing = this.db
        .prepare('SELECT 1 AS found FROM votes WHERE user_id = ? AND icon_id = ?')
        .get(userId, iconId);
      if (existing) {
        this.db.exec('COMMIT');
        return 'exists';
      }
      const count = this.countVotesForUser(userId);
      if (count >= maxVotes) {
        this.db.exec('COMMIT');
        return 'limit';
      }
      this.db
        .prepare('INSERT INTO votes (user_id, icon_id, created_at) VALUES (?, ?, ?)')
        .run(userId, iconId, this.nowIso());
      this.db.exec('COMMIT');
      return 'added';
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* 忽略回滚失败 */
      }
      throw error;
    }
  }

  /**
   * @returns {'removed'|'absent'|'closed'}
   */
  removeVote({ userId, iconId }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.isVotingOpen()) {
        this.db.exec('COMMIT');
        return 'closed';
      }
      const result = this.db
        .prepare('DELETE FROM votes WHERE user_id = ? AND icon_id = ?')
        .run(userId, iconId);
      this.db.exec('COMMIT');
      return Number(result.changes) > 0 ? 'removed' : 'absent';
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* 忽略回滚失败 */
      }
      throw error;
    }
  }

  resetVotes() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('DELETE FROM votes').run();
      this.db.exec('COMMIT');
      return Number(result.changes);
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* 忽略回滚失败 */
      }
      throw error;
    }
  }

  // ---------- 聚合查询 ----------

  getIconCounts() {
    const rows = this.db
      .prepare('SELECT icon_id, COUNT(*) AS count FROM votes GROUP BY icon_id')
      .all();
    const map = new Map();
    for (const row of rows) map.set(row.icon_id, Number(row.count));
    return map;
  }

  getTotals() {
    const totalVotes = this.db.prepare('SELECT COUNT(*) AS count FROM votes').get();
    const voters = this.db.prepare('SELECT COUNT(DISTINCT user_id) AS count FROM votes').get();
    const users = this.db.prepare('SELECT COUNT(*) AS count FROM users').get();
    return {
      totalVotes: Number(totalVotes?.count ?? 0),
      votersCount: Number(voters?.count ?? 0),
      userCount: Number(users?.count ?? 0),
    };
  }

  getRecentVotes(limit = 20) {
    return this.db
      .prepare(
        `SELECT u.nick AS nick, v.icon_id AS icon_id, v.created_at AS created_at
         FROM votes v JOIN users u ON u.id = v.user_id
         ORDER BY v.created_at DESC, v.id DESC
         LIMIT ?`,
      )
      .all(limit);
  }

  /**
   * 投票人明细（仅管理员可见）：按最近投票时间倒序。
   */
  getVoters() {
    const rows = this.db
      .prepare(
        `SELECT u.id AS user_id, u.nick AS nick, u.avatar_url AS avatar_url,
                v.icon_id AS icon_id, v.created_at AS created_at
         FROM votes v JOIN users u ON u.id = v.user_id
         ORDER BY v.created_at DESC, v.id DESC`,
      )
      .all();
    const voters = new Map();
    for (const row of rows) {
      let voter = voters.get(row.user_id);
      if (!voter) {
        voter = {
          nick: row.nick,
          avatarUrl: row.avatar_url || '',
          votes: [],
          lastVotedAt: row.created_at,
        };
        voters.set(row.user_id, voter);
      }
      voter.votes.push({ iconId: row.icon_id, createdAt: row.created_at });
    }
    for (const voter of voters.values()) {
      voter.votes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    return [...voters.values()];
  }

  getExportRows() {
    return this.db
      .prepare(
        `SELECT u.nick AS nick, v.icon_id AS icon_id, v.created_at AS created_at
         FROM votes v JOIN users u ON u.id = v.user_id
         ORDER BY u.nick COLLATE NOCASE ASC, v.created_at ASC, v.id ASC`,
      )
      .all();
  }
}

export function createStore(options) {
  return new Store(options);
}

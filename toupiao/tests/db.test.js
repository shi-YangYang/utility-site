import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStore, DatabaseError } from '../server/db.js';

const silent = { warn() {}, info() {}, error() {} };

test('数据库：WAL、foreign_keys、user_version 与同名不同 unionId 独立计票', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'toupiao-db-'));
  const store = createStore({ dataDir: dir, logger: silent });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const journal = store.db.prepare('PRAGMA journal_mode').get();
  assert.equal(String(journal.journal_mode).toLowerCase(), 'wal');
  assert.equal(Number(store.db.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get().user_version), 1);
  assert.equal(store.isVotingOpen(), true);
  assert.equal(store.getTotals().totalVotes, 0);

  const first = store.upsertUser({ unionId: 'union-a', nick: '同名员工', avatarUrl: '' });
  const second = store.upsertUser({ unionId: 'union-b', nick: '同名员工', avatarUrl: '' });
  assert.notEqual(first.id, second.id, '同名但 unionId 不同应是两个用户');
  assert.equal(store.addVote({ userId: first.id, iconId: '01' }), 'added');
  assert.equal(store.addVote({ userId: second.id, iconId: '01' }), 'added');
  assert.equal(store.getTotals().totalVotes, 2);
  assert.equal(store.getTotals().votersCount, 2);

  assert.throws(
    () =>
      store.db
        .prepare('INSERT INTO votes (user_id, icon_id, created_at) VALUES (?, ?, ?)')
        .run(999999, '02', new Date().toISOString()),
    /FOREIGN KEY/i,
    'foreign_keys=ON 应拒绝不存在的用户',
  );
});

test('数据库：文件损坏或路径不可用时抛出带路径的 DatabaseError，不静默用内存库', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'toupiao-db-bad-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  writeFileSync(join(dataDir, 'toupiao.db'), 'this is definitely not a sqlite database');

  assert.throws(
    () => createStore({ dataDir, logger: silent }),
    (error) =>
      error instanceof DatabaseError &&
      error.message.includes('toupiao.db') &&
      error.message.length > 10,
  );

  const notADirectory = join(dir, 'not-a-directory');
  writeFileSync(notADirectory, 'x');
  assert.throws(
    () => createStore({ dataDir: notADirectory, logger: silent }),
    (error) => error instanceof DatabaseError && error.message.includes('toupiao.db'),
  );
});

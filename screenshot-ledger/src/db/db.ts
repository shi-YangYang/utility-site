import * as SQLite from 'expo-sqlite';

import { DEFAULT_CATEGORIES, DEFAULT_PLATFORMS } from '@/lib/categories';

const DATABASE_NAME = 'screenshot-ledger.db';
const SCHEMA_VERSION = 3;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) databasePromise = openAndMigrate();
  return databasePromise;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;

  if (version < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount_cents INTEGER NOT NULL,
        direction TEXT NOT NULL,
        merchant TEXT,
        category TEXT NOT NULL,
        pay_method TEXT,
        platform TEXT,
        tx_time TEXT NOT NULL,
        note TEXT,
        image_path TEXT,
        image_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_records_tx_time ON records (tx_time);
    `);
  }

  if (version < 2) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS categories (
        name TEXT PRIMARY KEY NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `);
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i += 1) {
      await db.runAsync(
        'INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)',
        DEFAULT_CATEGORIES[i],
        i,
      );
    }
  }

  if (version < 3) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS platforms (
        name TEXT PRIMARY KEY NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `);
    for (let i = 0; i < DEFAULT_PLATFORMS.length; i += 1) {
      await db.runAsync(
        'INSERT OR IGNORE INTO platforms (name, sort_order) VALUES (?, ?)',
        DEFAULT_PLATFORMS[i],
        i,
      );
    }
  }

  if (version < SCHEMA_VERSION) {
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  return db;
}

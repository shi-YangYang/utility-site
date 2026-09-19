import { monthRange } from '@/lib/dates';
import type { LedgerRecord, RecordDraft } from '@/lib/types';

import { getDb } from './db';

interface RecordRow {
  id: number;
  amount_cents: number;
  direction: string;
  merchant: string | null;
  category: string;
  pay_method: string | null;
  platform: string | null;
  tx_time: string;
  note: string | null;
  image_path: string | null;
  image_hash: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: RecordRow): LedgerRecord {
  return {
    id: row.id,
    amountCents: row.amount_cents,
    direction: row.direction === 'income' ? 'income' : 'expense',
    merchant: row.merchant,
    category: row.category,
    payMethod: row.pay_method,
    platform: row.platform,
    txTime: row.tx_time,
    note: row.note,
    imagePath: row.image_path,
    imageHash: row.image_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertRecord(draft: RecordDraft): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO records
      (amount_cents, direction, merchant, category, pay_method, platform, tx_time, note, image_path, image_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    draft.amountCents,
    draft.direction,
    draft.merchant,
    draft.category,
    draft.payMethod,
    draft.platform,
    draft.txTime,
    draft.note,
    draft.imagePath,
    draft.imageHash,
    now,
    now,
  );
  return result.lastInsertRowId;
}

export async function updateRecord(id: number, draft: RecordDraft): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE records SET
      amount_cents = ?, direction = ?, merchant = ?, category = ?, pay_method = ?,
      platform = ?, tx_time = ?, note = ?, updated_at = ?
     WHERE id = ?`,
    draft.amountCents,
    draft.direction,
    draft.merchant,
    draft.category,
    draft.payMethod,
    draft.platform,
    draft.txTime,
    draft.note,
    new Date().toISOString(),
    id,
  );
}

export async function deleteRecord(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM records WHERE id = ?', id);
}

export async function getRecord(id: number): Promise<LedgerRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RecordRow>('SELECT * FROM records WHERE id = ?', id);
  return row ? toRecord(row) : null;
}

export async function listRecords(): Promise<LedgerRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RecordRow>(
    'SELECT * FROM records ORDER BY tx_time DESC, id DESC',
  );
  return rows.map(toRecord);
}

export async function listRecordsByMonth(monthKey: string): Promise<LedgerRecord[]> {
  const db = await getDb();
  const { start, end } = monthRange(monthKey);
  const rows = await db.getAllAsync<RecordRow>(
    'SELECT * FROM records WHERE tx_time >= ? AND tx_time < ? ORDER BY tx_time DESC, id DESC',
    start,
    end,
  );
  return rows.map(toRecord);
}

export async function countRecordsWithImageHash(hash: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM records WHERE image_hash = ?',
    hash,
  );
  return row?.count ?? 0;
}

import { DEFAULT_PLATFORMS, MAX_OPTION_LENGTH, normalizeOptionName } from '@/lib/categories';

import { getDb } from './db';

export async function listPlatforms(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string }>(
    'SELECT name FROM platforms ORDER BY sort_order, name',
  );
  if (rows.length === 0) return [...DEFAULT_PLATFORMS];
  return rows.map((row) => row.name);
}

export async function addPlatform(
  input: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const name = normalizeOptionName(input);
  if (!name) return { ok: false, error: `名称需要 1-${MAX_OPTION_LENGTH} 个字符` };
  const db = await getDb();
  const existing = await db.getFirstAsync<{ name: string }>(
    'SELECT name FROM platforms WHERE name = ?',
    name,
  );
  if (existing) return { ok: false, error: '这个平台已经存在' };
  const maxRow = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX(sort_order) AS maxOrder FROM platforms',
  );
  await db.runAsync(
    'INSERT INTO platforms (name, sort_order) VALUES (?, ?)',
    name,
    (maxRow?.maxOrder ?? 0) + 1,
  );
  return { ok: true, name };
}

export async function removePlatform(name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM platforms WHERE name = ?', name);
}

import {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY,
  MAX_CATEGORY_LENGTH,
  normalizeCategoryName,
} from '@/lib/categories';

import { getDb } from './db';

export async function listCategories(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string }>(
    'SELECT name FROM categories ORDER BY sort_order, name',
  );
  if (rows.length === 0) return [...DEFAULT_CATEGORIES];
  return rows.map((row) => row.name);
}

export async function addCategory(
  input: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const name = normalizeCategoryName(input);
  if (!name) return { ok: false, error: `名称需要 1-${MAX_CATEGORY_LENGTH} 个字符` };
  const db = await getDb();
  const existing = await db.getFirstAsync<{ name: string }>(
    'SELECT name FROM categories WHERE name = ?',
    name,
  );
  if (existing) return { ok: false, error: '这个分类已经存在' };
  const maxRow = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX(sort_order) AS maxOrder FROM categories',
  );
  await db.runAsync(
    'INSERT INTO categories (name, sort_order) VALUES (?, ?)',
    name,
    (maxRow?.maxOrder ?? 0) + 1,
  );
  return { ok: true, name };
}

export async function removeCategory(name: string): Promise<void> {
  if (name === DEFAULT_CATEGORY) return;
  const db = await getDb();
  await db.runAsync('DELETE FROM categories WHERE name = ?', name);
}

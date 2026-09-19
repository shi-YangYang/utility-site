import { DEFAULT_CATEGORY } from './categories';
import type { Direction } from './types';

export interface SummarizableRecord {
  amountCents: number;
  direction: Direction;
  category: string;
}

export interface CategoryStat {
  category: string;
  cents: number;
  ratio: number;
}

export interface MonthlySummary {
  expenseCents: number;
  incomeCents: number;
  count: number;
  byCategory: CategoryStat[];
}

export function summarize(records: SummarizableRecord[]): MonthlySummary {
  let expenseCents = 0;
  let incomeCents = 0;
  const byCategory = new Map<string, number>();

  for (const record of records) {
    if (record.direction === 'income') {
      incomeCents += record.amountCents;
      continue;
    }
    expenseCents += record.amountCents;
    const category = record.category || DEFAULT_CATEGORY;
    byCategory.set(category, (byCategory.get(category) ?? 0) + record.amountCents);
  }

  const stats: CategoryStat[] = [...byCategory.entries()]
    .map(([category, cents]) => ({
      category,
      cents,
      ratio: expenseCents > 0 ? cents / expenseCents : 0,
    }))
    .sort((a, b) => b.cents - a.cents || (a.category < b.category ? -1 : 1));

  return { expenseCents, incomeCents, count: records.length, byCategory: stats };
}

export function formatRatio(ratio: number): string {
  const percent = Math.round(ratio * 1000) / 10;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

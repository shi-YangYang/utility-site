import { exportBaseName } from './export-names';
import { formatCents } from './money';
import type { LedgerRecord } from './types';

export const CSV_MIME = 'text/csv';

const HEADERS = ['日期时间', '方向', '金额', '分类', '商户', '平台', '备注'];

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv(records: LedgerRecord[]): string {
  const lines = records.map((record) =>
    [
      record.txTime.replace('T', ' '),
      record.direction === 'income' ? '收入' : '支出',
      formatCents(record.amountCents),
      record.category,
      record.merchant ?? '',
      record.platform ?? '',
      record.note ?? '',
    ]
      .map(escapeCell)
      .join(','),
  );
  return `\uFEFF${[HEADERS.join(','), ...lines].join('\r\n')}`;
}

export function csvFileName(monthKey: string | null, today: Date): string {
  return `${exportBaseName(monthKey, today)}.csv`;
}

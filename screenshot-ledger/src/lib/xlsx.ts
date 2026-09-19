import * as XLSX from 'xlsx';

import type { LedgerRecord } from './types';

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SHEET_NAME = '账目';
const HEADERS = ['日期时间', '方向', '金额', '分类', '商户', '支付方式', '平台', '备注'];
const COLUMN_WIDTHS = [18, 8, 10, 8, 20, 12, 10, 30];

function toRow(record: LedgerRecord): (string | number)[] {
  return [
    record.txTime.replace('T', ' '),
    record.direction === 'income' ? '收入' : '支出',
    record.amountCents / 100,
    record.category,
    record.merchant ?? '',
    record.payMethod ?? '',
    record.platform ?? '',
    record.note ?? '',
  ];
}

export function buildWorkbookBase64(records: LedgerRecord[]): string {
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...records.map(toRow)]);
  sheet['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }));
  records.forEach((_, index) => {
    const cell = sheet[`C${index + 2}`];
    if (cell) cell.z = '0.00';
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAME);
  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
}

export function exportFileName(monthKey: string | null, today: Date): string {
  if (monthKey) return `截图记账-${monthKey}.xlsx`;
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `截图记账-全部-${today.getFullYear()}-${month}-${day}.xlsx`;
}

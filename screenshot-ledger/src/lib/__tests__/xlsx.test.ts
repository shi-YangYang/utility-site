import * as XLSX from 'xlsx';

import type { LedgerRecord } from '../types';
import { buildWorkbookBase64, exportFileName, XLSX_MIME } from '../xlsx';

function makeRecord(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    id: 1,
    amountCents: 2350,
    direction: 'expense',
    merchant: '肯德基',
    category: '餐饮',
    payMethod: '微信支付',
    platform: '京东',
    txTime: '2026-09-18T12:30',
    note: '订单 123',
    imagePath: null,
    imageHash: null,
    createdAt: '2026-09-18T12:31:00.000Z',
    updatedAt: '2026-09-18T12:31:00.000Z',
    ...overrides,
  };
}

function readRows(base64: string) {
  const workbook = XLSX.read(base64, { type: 'base64' });
  expect(workbook.SheetNames).toEqual(['账目']);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['账目']);
}

describe('buildWorkbookBase64', () => {
  it('生成可被重新读取的工作簿，金额是数值', () => {
    const rows = readRows(buildWorkbookBase64([makeRecord()]));
    expect(rows).toHaveLength(1);
    expect(rows[0]['日期时间']).toBe('2026-09-18 12:30');
    expect(rows[0]['方向']).toBe('支出');
    expect(rows[0]['金额']).toBe(23.5);
    expect(rows[0]['分类']).toBe('餐饮');
    expect(rows[0]['商户']).toBe('肯德基');
    expect(rows[0]['支付方式']).toBe('微信支付');
    expect(rows[0]['平台']).toBe('京东');
    expect(rows[0]['备注']).toBe('订单 123');
  });

  it('收入方向与空字段', () => {
    const rows = readRows(
      buildWorkbookBase64([
        makeRecord({
          direction: 'income',
          merchant: null,
          payMethod: null,
          platform: null,
          note: null,
        }),
      ]),
    );
    expect(rows[0]['方向']).toBe('收入');
    expect(rows[0]['商户'] ?? '').toBe('');
    expect(rows[0]['备注'] ?? '').toBe('');
  });

  it('空记录只有表头', () => {
    expect(readRows(buildWorkbookBase64([]))).toHaveLength(0);
  });
});

describe('exportFileName', () => {
  it('按月导出', () => {
    expect(exportFileName('2026-09', new Date(2026, 8, 18))).toBe('截图记账-2026-09.xlsx');
  });

  it('全部导出带当天日期', () => {
    expect(exportFileName(null, new Date(2026, 8, 18))).toBe(
      '截图记账-全部-2026-09-18.xlsx',
    );
  });
});

describe('XLSX_MIME', () => {
  it('是 Excel 工作簿的 MIME', () => {
    expect(XLSX_MIME).toContain('spreadsheetml');
  });
});

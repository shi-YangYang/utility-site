import { buildCsv, csvFileName } from '../csv';
import type { LedgerRecord } from '../types';

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

describe('buildCsv', () => {
  it('带 BOM 表头，字段格式正确', () => {
    const csv = buildCsv([makeRecord()]);
    const lines = csv.split('\r\n');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(lines[0]).toBe('\uFEFF日期时间,方向,金额,分类,商户,支付方式,平台,备注');
    expect(lines[1]).toBe('2026-09-18 12:30,支出,23.50,餐饮,肯德基,微信支付,京东,订单 123');
  });

  it('收入方向与空字段', () => {
    const csv = buildCsv([
      makeRecord({
        direction: 'income',
        merchant: null,
        payMethod: null,
        platform: null,
        note: null,
      }),
    ]);
    expect(csv.split('\r\n')[1]).toBe('2026-09-18 12:30,收入,23.50,餐饮,,,,');
  });

  it('转义逗号、引号与换行', () => {
    const csv = buildCsv([makeRecord({ merchant: '张三,李四', note: '他说"好"\n然后走了' })]);
    expect(csv).toContain('"张三,李四"');
    expect(csv).toContain('"他说""好""\n然后走了"');
  });

  it('空记录只有表头', () => {
    expect(buildCsv([])).toBe('\uFEFF日期时间,方向,金额,分类,商户,支付方式,平台,备注');
  });
});

describe('csvFileName', () => {
  it('按月与全部两种命名', () => {
    expect(csvFileName('2026-09', new Date(2026, 8, 18))).toBe('截图记账-2026-09.csv');
    expect(csvFileName(null, new Date(2026, 8, 18))).toBe('截图记账-全部-2026-09-18.csv');
  });
});

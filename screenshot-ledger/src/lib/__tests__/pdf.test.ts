import { buildReportHtml } from '../pdf';
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

describe('buildReportHtml', () => {
  const generatedAt = new Date(2026, 8, 19, 9, 5);

  it('包含标题、时间、总计、分类与明细', () => {
    const html = buildReportHtml([makeRecord()], { title: '截图记账 · 2026年9月', generatedAt });
    expect(html).toContain('截图记账 · 2026年9月');
    expect(html).toContain('导出时间：2026-09-19 09:05');
    expect(html).toContain('¥23.50');
    expect(html).toContain('肯德基');
    expect(html).toContain('餐饮');
    expect(html).toContain('1 笔');
  });

  it('转义用户输入里的 HTML', () => {
    const html = buildReportHtml(
      [makeRecord({ merchant: '<b>店</b>', note: 'a&b' })],
      { title: '标题 <x>', generatedAt },
    );
    expect(html).toContain('&lt;b&gt;店&lt;/b&gt;');
    expect(html).toContain('a&amp;b');
    expect(html).toContain('标题 &lt;x&gt;');
    expect(html).not.toContain('<b>店</b>');
  });

  it('收入行显示加号与收入方向', () => {
    const html = buildReportHtml(
      [makeRecord({ direction: 'income', amountCents: 10000 })],
      { title: 't', generatedAt },
    );
    expect(html).toContain('<td>收入</td>');
    expect(html).toContain('+100.00');
  });

  it('没有记录时给出占位', () => {
    const html = buildReportHtml([], { title: 't', generatedAt });
    expect(html).toContain('无支出记录');
  });
});

import { formatRatio, summarize } from '../summary';

describe('summarize', () => {
  it('统计收支与分类占比', () => {
    const result = summarize([
      { amountCents: 2350, direction: 'expense', category: '餐饮' },
      { amountCents: 7650, direction: 'expense', category: '购物' },
      { amountCents: 1000, direction: 'income', category: '转账' },
      { amountCents: 2350, direction: 'expense', category: '餐饮' },
    ]);
    expect(result.expenseCents).toBe(12350);
    expect(result.incomeCents).toBe(1000);
    expect(result.count).toBe(4);
    expect(result.byCategory[0]).toEqual({
      category: '购物',
      cents: 7650,
      ratio: 7650 / 12350,
    });
    expect(result.byCategory[1].category).toBe('餐饮');
    expect(result.byCategory[1].cents).toBe(4700);
  });

  it('没有支出时占比为 0 且分类为空', () => {
    const result = summarize([{ amountCents: 100, direction: 'income', category: '转账' }]);
    expect(result.expenseCents).toBe(0);
    expect(result.byCategory).toEqual([]);
  });

  it('空数组', () => {
    expect(summarize([])).toEqual({
      expenseCents: 0,
      incomeCents: 0,
      count: 0,
      byCategory: [],
    });
  });
});

describe('formatRatio', () => {
  it('保留一位小数、整数不带小数点', () => {
    expect(formatRatio(0.5)).toBe('50%');
    expect(formatRatio(1 / 3)).toBe('33.3%');
    expect(formatRatio(0)).toBe('0%');
    expect(formatRatio(0.1234)).toBe('12.3%');
  });
});

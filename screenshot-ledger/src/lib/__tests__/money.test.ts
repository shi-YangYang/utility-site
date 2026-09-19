import { formatCents, formatSignedCents, parseAmountToCents } from '../money';

describe('parseAmountToCents', () => {
  it('解析常见金额写法', () => {
    expect(parseAmountToCents('23.50')).toBe(2350);
    expect(parseAmountToCents('23.5')).toBe(2350);
    expect(parseAmountToCents('23')).toBe(2300);
    expect(parseAmountToCents('0.01')).toBe(1);
    expect(parseAmountToCents('1,234.56')).toBe(123456);
    expect(parseAmountToCents('¥ 88')).toBe(8800);
    expect(parseAmountToCents('￥100.00')).toBe(10000);
    expect(parseAmountToCents('.5')).toBe(50);
    expect(parseAmountToCents('  12.30  ')).toBe(1230);
  });

  it('拒绝非法金额', () => {
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('12.345')).toBeNull();
    expect(parseAmountToCents('12.')).toBeNull();
    expect(parseAmountToCents('-5')).toBeNull();
    expect(parseAmountToCents('1.2.3')).toBeNull();
  });
});

describe('formatCents', () => {
  it('格式化两位小数', () => {
    expect(formatCents(2350)).toBe('23.50');
    expect(formatCents(1)).toBe('0.01');
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(100000)).toBe('1000.00');
  });
});

describe('formatSignedCents', () => {
  it('按方向加符号', () => {
    expect(formatSignedCents(2350, 'expense')).toBe('-23.50');
    expect(formatSignedCents(2350, 'income')).toBe('+23.50');
  });
});

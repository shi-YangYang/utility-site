import {
  formatDayLabel,
  groupRecordsByDay,
  monthKeyOf,
  monthLabel,
  monthRange,
  normalizeTxTime,
  nowAsTxTime,
  shiftMonth,
  txTimeToDisplay,
} from '../dates';

describe('normalizeTxTime', () => {
  it('接受常见格式并归一化', () => {
    expect(normalizeTxTime('2026-09-18 12:30')).toBe('2026-09-18T12:30');
    expect(normalizeTxTime('2026-09-18T12:30')).toBe('2026-09-18T12:30');
    expect(normalizeTxTime('2026-09-18 12:30:45')).toBe('2026-09-18T12:30');
    expect(normalizeTxTime('2026/9/8 9:05')).toBe('2026-09-08T09:05');
    expect(normalizeTxTime('2026-09-18')).toBe('2026-09-18T00:00');
  });

  it('拒绝非法时间', () => {
    expect(normalizeTxTime('')).toBeNull();
    expect(normalizeTxTime('2026-13-01 10:00')).toBeNull();
    expect(normalizeTxTime('2026-02-30 10:00')).toBeNull();
    expect(normalizeTxTime('2026-09-18 25:00')).toBeNull();
    expect(normalizeTxTime('昨天')).toBeNull();
  });
});

describe('月份工具', () => {
  it('monthKey 与 label', () => {
    expect(monthKeyOf(new Date(2026, 8, 18))).toBe('2026-09');
    expect(monthLabel('2026-09')).toBe('2026年9月');
  });

  it('shiftMonth 跨年', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('monthRange 到下月一号', () => {
    expect(monthRange('2026-09')).toEqual({
      start: '2026-09-01T00:00',
      end: '2026-10-01T00:00',
    });
    expect(monthRange('2026-12')).toEqual({
      start: '2026-12-01T00:00',
      end: '2027-01-01T00:00',
    });
  });
});

describe('nowAsTxTime / txTimeToDisplay', () => {
  it('补零', () => {
    expect(nowAsTxTime(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05T09:07');
    expect(txTimeToDisplay('2026-01-05T09:07')).toBe('2026-01-05 09:07');
  });
});

describe('formatDayLabel', () => {
  const today = new Date(2026, 8, 18);

  it('今天 / 昨天 / 更早', () => {
    expect(formatDayLabel('2026-09-18', today)).toBe('今天');
    expect(formatDayLabel('2026-09-17', today)).toBe('昨天');
    expect(formatDayLabel('2026-09-01', today)).toBe('9月1日 周二');
  });
});

describe('groupRecordsByDay', () => {
  const today = new Date(2026, 8, 18);

  it('按天分组并累计支出', () => {
    const groups = groupRecordsByDay(
      [
        { txTime: '2026-09-18T12:30', amountCents: 2350, direction: 'expense' as const, tag: 'a' },
        { txTime: '2026-09-18T09:00', amountCents: 500, direction: 'expense' as const, tag: 'b' },
        { txTime: '2026-09-18T08:00', amountCents: 1000, direction: 'income' as const, tag: 'c' },
        { txTime: '2026-09-17T20:00', amountCents: 990, direction: 'expense' as const, tag: 'd' },
      ],
      today,
    );
    expect(groups.map((group) => group.label)).toEqual(['今天', '昨天']);
    expect(groups[0].expenseCents).toBe(2850);
    expect(groups[0].records.map((record) => record.tag)).toEqual(['a', 'b', 'c']);
    expect(groups[1].expenseCents).toBe(990);
  });
});

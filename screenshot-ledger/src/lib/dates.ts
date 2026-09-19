import type { Direction } from './types';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const TX_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/;
const DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function buildTxTime(year: number, month: number, day: number, hour: number, minute: number): string | null {
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`;
}

export function normalizeTxTime(input: string): string | null {
  const text = input.trim();
  const match = text.match(TX_RE);
  if (match) {
    return buildTxTime(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    );
  }
  const dateOnly = text.match(DATE_RE);
  if (dateOnly) {
    return buildTxTime(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3]),
      0,
      0,
    );
  }
  return null;
}

export function nowAsTxTime(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(
    now.getHours(),
  )}:${pad2(now.getMinutes())}`;
}

export function txTimeToDisplay(txTime: string): string {
  return txTime.replace('T', ' ');
}

export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function monthKeyOfTxTime(txTime: string): string {
  return txTime.slice(0, 7);
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return monthKeyOf(date);
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year}年${month}月`;
}

export function monthRange(monthKey: string): { start: string; end: string } {
  const start = `${monthKey}-01T00:00`;
  const [year, month] = monthKey.split('-').map(Number);
  const next = new Date(year, month, 1);
  const end = `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-01T00:00`;
  return { start, end };
}

export function dayKeyOf(txTime: string): string {
  return txTime.slice(0, 10);
}

export function formatDayLabel(dayKey: string, today: Date): string {
  const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  if (dayKey === todayKey) return '今天';
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${pad2(yesterday.getMonth() + 1)}-${pad2(
    yesterday.getDate(),
  )}`;
  if (dayKey === yesterdayKey) return '昨天';
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return `${month}月${day}日 ${WEEKDAYS[date.getDay()]}`;
}

export interface DayGroup<T> {
  dayKey: string;
  label: string;
  expenseCents: number;
  totalCents: number;
  records: T[];
}

export function groupRecordsByDay<
  T extends { txTime: string; amountCents: number; direction: Direction },
>(records: T[], today: Date): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const index = new Map<string, DayGroup<T>>();
  for (const record of records) {
    const dayKey = dayKeyOf(record.txTime);
    let group = index.get(dayKey);
    if (!group) {
      group = {
        dayKey,
        label: formatDayLabel(dayKey, today),
        expenseCents: 0,
        totalCents: 0,
        records: [],
      };
      index.set(dayKey, group);
      groups.push(group);
    }
    group.records.push(record);
    if (record.direction === 'expense') {
      group.expenseCents += record.amountCents;
      group.totalCents += record.amountCents;
    } else {
      group.totalCents -= record.amountCents;
    }
  }
  return groups;
}

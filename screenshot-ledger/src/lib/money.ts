import type { Direction } from './types';

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

export function parseAmountToCents(input: string): number | null {
  let s = input.trim().replace(/[¥￥,\s]/g, '');
  if (s.startsWith('.')) s = `0${s}`;
  if (!AMOUNT_RE.test(s)) return null;
  const [intPart, decPart = ''] = s.split('.');
  const cents = Number(intPart) * 100 + Number((decPart + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatSignedCents(cents: number, direction: Direction): string {
  return `${direction === 'income' ? '+' : '-'}${formatCents(cents)}`;
}

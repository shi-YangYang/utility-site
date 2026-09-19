import { DEFAULT_CATEGORY } from './categories';
import { normalizeTxTime, nowAsTxTime, txTimeToDisplay } from './dates';
import { formatCents, parseAmountToCents } from './money';
import type { Direction, LedgerRecord, LlmExtraction } from './types';

export interface RecordFormValues {
  amount: string;
  direction: Direction;
  merchant: string;
  category: string;
  platform: string;
  txTime: string;
  note: string;
}

export interface ValidatedForm {
  amountCents: number;
  direction: Direction;
  merchant: string | null;
  category: string;
  platform: string | null;
  txTime: string;
  note: string | null;
}

export function emptyFormValues(now: Date = new Date()): RecordFormValues {
  return {
    amount: '',
    direction: 'expense',
    merchant: '',
    category: DEFAULT_CATEGORY,
    platform: '',
    txTime: txTimeToDisplay(nowAsTxTime(now)),
    note: '',
  };
}

export function formValuesFromExtraction(
  extraction: LlmExtraction,
  now: Date = new Date(),
): RecordFormValues {
  return {
    amount: extraction.amountCents != null ? formatCents(extraction.amountCents) : '',
    direction: extraction.direction,
    merchant: extraction.merchant ?? '',
    category: extraction.category || DEFAULT_CATEGORY,
    platform: extraction.platform ?? '',
    txTime: txTimeToDisplay(extraction.txTime ?? nowAsTxTime(now)),
    note: extraction.note ?? '',
  };
}

export function formValuesFromRecord(record: LedgerRecord): RecordFormValues {
  return {
    amount: formatCents(record.amountCents),
    direction: record.direction,
    merchant: record.merchant ?? '',
    category: record.category,
    platform: record.platform ?? '',
    txTime: txTimeToDisplay(record.txTime),
    note: record.note ?? '',
  };
}

export function validateFormValues(
  values: RecordFormValues,
): { ok: true; value: ValidatedForm } | { ok: false; error: string } {
  const amountCents = parseAmountToCents(values.amount);
  if (amountCents == null) return { ok: false, error: '金额格式不对，请输入数字，最多两位小数' };
  if (amountCents <= 0) return { ok: false, error: '金额需要大于 0' };
  const txTime = normalizeTxTime(values.txTime);
  if (!txTime) return { ok: false, error: '时间格式应为 2026-09-18 12:30' };
  return {
    ok: true,
    value: {
      amountCents,
      direction: values.direction,
      merchant: values.merchant.trim() || null,
      category: values.category.trim() || DEFAULT_CATEGORY,
      platform: values.platform || null,
      txTime,
      note: values.note.trim() || null,
    },
  };
}

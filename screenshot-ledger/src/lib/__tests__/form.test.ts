import {
  emptyFormValues,
  formValuesFromExtraction,
  formValuesFromRecord,
  validateFormValues,
} from '../form';
import type { LedgerRecord, LlmExtraction } from '../types';

const EXTRACTION: LlmExtraction = {
  isPayment: true,
  amountCents: 2350,
  direction: 'expense',
  merchant: '肯德基',
  category: '餐饮',
  payMethod: '微信支付',
  platform: '京东',
  txTime: '2026-09-18T12:30',
  note: '订单 123',
  confidence: 'high',
};

const RECORD: LedgerRecord = {
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
};

describe('emptyFormValues', () => {
  it('默认支出、其他分类、当前时间', () => {
    const values = emptyFormValues(new Date(2026, 8, 18, 12, 30));
    expect(values).toEqual({
      amount: '',
      direction: 'expense',
      merchant: '',
      category: '其他',
      payMethod: '',
      platform: '',
      txTime: '2026-09-18 12:30',
      note: '',
    });
  });
});

describe('formValuesFromExtraction', () => {
  it('把识别结果转成表单值', () => {
    const values = formValuesFromExtraction(EXTRACTION, new Date(2026, 0, 1));
    expect(values.amount).toBe('23.50');
    expect(values.merchant).toBe('肯德基');
    expect(values.category).toBe('餐饮');
    expect(values.txTime).toBe('2026-09-18 12:30');
  });

  it('时间为空时用当前时间，金额为空时留空', () => {
    const values = formValuesFromExtraction(
      { ...EXTRACTION, amountCents: null, txTime: null },
      new Date(2026, 8, 18, 12, 30),
    );
    expect(values.amount).toBe('');
    expect(values.txTime).toBe('2026-09-18 12:30');
  });
});

describe('formValuesFromRecord', () => {
  it('与表单值互转', () => {
    const values = formValuesFromRecord(RECORD);
    const result = validateFormValues(values);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.amountCents).toBe(2350);
      expect(result.value.txTime).toBe('2026-09-18T12:30');
    }
  });
});

describe('validateFormValues', () => {
  function valuesWith(overrides: Partial<ReturnType<typeof emptyFormValues>>) {
    return { ...emptyFormValues(new Date(2026, 8, 18, 12, 30)), amount: '23.50', ...overrides };
  }

  it('通过合法输入并做清洗', () => {
    const result = validateFormValues(
      valuesWith({ merchant: '  肯德基  ', note: '  订单  ', category: '不存在' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.merchant).toBe('肯德基');
      expect(result.value.note).toBe('订单');
      expect(result.value.category).toBe('其他');
      expect(result.value.payMethod).toBeNull();
    }
  });

  it('拒绝非法金额与时间', () => {
    expect(validateFormValues(valuesWith({ amount: 'abc' })).ok).toBe(false);
    expect(validateFormValues(valuesWith({ amount: '0' })).ok).toBe(false);
    expect(validateFormValues(valuesWith({ amount: '0.00' })).ok).toBe(false);
    expect(validateFormValues(valuesWith({ txTime: '昨天' })).ok).toBe(false);
  });

  it('空字符串转为 null', () => {
    const result = validateFormValues(
      valuesWith({ merchant: '  ', payMethod: '', platform: '', note: '' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.merchant).toBeNull();
      expect(result.value.payMethod).toBeNull();
      expect(result.value.platform).toBeNull();
      expect(result.value.note).toBeNull();
    }
  });
});

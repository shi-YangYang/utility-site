export const DEFAULT_CATEGORIES = [
  '餐饮',
  '购物',
  '交通',
  '日用',
  '娱乐',
  '医疗',
  '居住',
  '转账',
  '其他',
] as const;

export const DEFAULT_PLATFORMS = ['京东', '淘宝', '拼多多', '微信', '支付宝', '其他'] as const;

export const DEFAULT_CATEGORY = '其他';
export const MAX_OPTION_LENGTH = 8;

export function normalizeOptionName(input: string): string | null {
  const name = input.trim();
  if (!name) return null;
  if ([...name].length > MAX_OPTION_LENGTH) return null;
  return name;
}

export const Colors = {
  background: '#F4F5F7',
  card: '#FFFFFF',
  text: '#1C1F23',
  subText: '#6B7280',
  border: '#E5E7EB',
  primary: '#2F6FED',
  primarySoft: '#E8F0FE',
  expense: '#D93A3F',
  income: '#0F9D58',
  danger: '#D93A3F',
  white: '#FFFFFF',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
};

const CATEGORY_COLORS: Record<string, string> = {
  餐饮: '#F59E0B',
  购物: '#3B82F6',
  交通: '#10B981',
  日用: '#8B5CF6',
  娱乐: '#EC4899',
  医疗: '#EF4444',
  居住: '#14B8A6',
  转账: '#6366F1',
  其他: '#9CA3AF',
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS['其他'];
}

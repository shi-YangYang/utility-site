export function exportBaseName(monthKey: string | null, today: Date): string {
  if (monthKey) return `截图记账-${monthKey}`;
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `截图记账-全部-${today.getFullYear()}-${month}-${day}`;
}

import { formatCents } from './money';
import { formatRatio, summarize } from './summary';
import type { LedgerRecord } from './types';

export const PDF_MIME = 'application/pdf';

export interface ReportOptions {
  title: string;
  generatedAt: Date;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function buildReportHtml(records: LedgerRecord[], options: ReportOptions): string {
  const summary = summarize(records);

  const categoryRows = summary.byCategory
    .map(
      (stat) =>
        `<tr><td>${escapeHtml(stat.category)}</td><td class="num">¥${formatCents(stat.cents)}</td><td class="num">${formatRatio(stat.ratio)}</td></tr>`,
    )
    .join('');

  const detailRows = records
    .map(
      (record) => `<tr>
        <td>${escapeHtml(record.txTime.replace('T', ' '))}</td>
        <td>${record.direction === 'income' ? '收入' : '支出'}</td>
        <td class="num">${record.direction === 'income' ? '+' : '-'}${formatCents(record.amountCents)}</td>
        <td>${escapeHtml(record.category)}</td>
        <td>${escapeHtml(record.merchant ?? '')}</td>
        <td>${escapeHtml(record.payMethod ?? '')}</td>
        <td>${escapeHtml(record.note ?? '')}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1c1f23; padding: 24px; }
  @page { margin: 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 20px 0 0; }
  .meta { color: #6b7280; font-size: 12px; margin: 0 0 16px; }
  .totals { display: flex; gap: 24px; }
  .totals div { font-size: 13px; }
  .totals strong { font-size: 18px; display: block; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
  th { background: #f4f5f7; }
  .num { text-align: right; }
</style>
</head>
<body>
  <h1>${escapeHtml(options.title)}</h1>
  <p class="meta">导出时间：${formatStamp(options.generatedAt)}</p>
  <div class="totals">
    <div>支出<strong>¥${formatCents(summary.expenseCents)}</strong></div>
    <div>收入<strong>¥${formatCents(summary.incomeCents)}</strong></div>
    <div>记录<strong>${summary.count} 笔</strong></div>
  </div>
  <h2>分类支出</h2>
  <table>
    <thead><tr><th>分类</th><th class="num">金额</th><th class="num">占比</th></tr></thead>
    <tbody>${categoryRows || '<tr><td colspan="3">无支出记录</td></tr>'}</tbody>
  </table>
  <h2>明细</h2>
  <table>
    <thead><tr><th>时间</th><th>方向</th><th class="num">金额</th><th>分类</th><th>商户</th><th>支付方式</th><th>备注</th></tr></thead>
    <tbody>${detailRows}</tbody>
  </table>
</body>
</html>`;
}

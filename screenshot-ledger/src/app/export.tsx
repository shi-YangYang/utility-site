import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { ChipGroup } from '@/components/chip-group';
import { categoryColor, Colors, Radius, Spacing } from '@/constants/theme';
import { listRecords, listRecordsByMonth } from '@/db/records';
import { buildCsv, CSV_MIME } from '@/lib/csv';
import { monthKeyOf, monthLabel } from '@/lib/dates';
import {
  canShare,
  shareBase64File,
  shareImageFile,
  shareTextFile,
} from '@/lib/export';
import { customExportBaseName, exportBaseName } from '@/lib/export-names';
import { EXPORT_HEADERS } from '@/lib/export-columns';
import { formatCents } from '@/lib/money';
import { buildReportHtml, PDF_MIME } from '@/lib/pdf';
import { formatRatio, summarize } from '@/lib/summary';
import type { LedgerRecord } from '@/lib/types';
import { buildWorkbookBase64, XLSX_MIME } from '@/lib/xlsx';

type FormatKey = 'xlsx' | 'csv' | 'pdf' | 'image';
type Scope = 'month' | 'all' | 'custom';

interface FormatOption {
  key: FormatKey;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const FORMATS: FormatOption[] = [
  {
    key: 'xlsx',
    label: 'Excel（.xlsx）',
    description: '带表头与列宽，金额可直接求和',
    icon: 'grid-outline',
  },
  {
    key: 'csv',
    label: 'CSV',
    description: '通用表格文本，兼容其他工具',
    icon: 'document-text-outline',
  },
  {
    key: 'pdf',
    label: 'PDF',
    description: '汇总、分类与全部明细，适合打印',
    icon: 'document-outline',
  },
  {
    key: 'image',
    label: '图片（PNG）',
    description: '把下方汇总卡存成图片，适合发聊天',
    icon: 'image-outline',
  },
];

const PREVIEW_LIMIT = 8;

function formatStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default function ExportScreen() {
  const params = useLocalSearchParams<{ monthKey?: string }>();
  const monthKey = params.monthKey ?? monthKeyOf(new Date());
  const [scope, setScope] = useState<Scope>('month');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [expandPreview, setExpandPreview] = useState(false);
  const [monthRecords, setMonthRecords] = useState<LedgerRecord[] | null>(null);
  const [allRecords, setAllRecords] = useState<LedgerRecord[] | null>(null);
  const [busy, setBusy] = useState<FormatKey | null>(null);
  const cardRef = useRef<View>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const [monthly, all] = await Promise.all([
          listRecordsByMonth(monthKey),
          listRecords(),
        ]);
        if (alive) {
          setMonthRecords(monthly);
          setAllRecords(all);
        }
      })();
      return () => {
        alive = false;
      };
    }, [monthKey]),
  );

  const selectedSet = new Set(selectedIds);
  const selectedRecords =
    allRecords?.filter((record) => selectedSet.has(record.id)) ?? null;
  const records =
    scope === 'month' ? monthRecords : scope === 'all' ? allRecords : selectedRecords;
  const summary = summarize(records ?? []);
  const scopeLabel =
    scope === 'month'
      ? monthLabel(monthKey)
      : scope === 'all'
        ? '全部记录'
        : `自选 ${selectedRecords?.length ?? 0} 项`;
  const fileBase =
    scope === 'custom'
      ? customExportBaseName(new Date())
      : exportBaseName(scope === 'month' ? monthKey : null, new Date());
  const customDisabled = scope === 'custom' && selectedIds.length === 0;
  const previewRows =
    records == null ? [] : expandPreview ? records : records.slice(0, PREVIEW_LIMIT);

  function toggleRecord(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function selectAll() {
    setSelectedIds((allRecords ?? []).map((record) => record.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  async function run(key: FormatKey, task: (rows: LedgerRecord[]) => Promise<void>) {
    if (!records || records.length === 0) {
      Alert.alert(
        '没有可导出的记录',
        scope === 'custom'
          ? '请先在列表里勾选要导出的记录。'
          : scope === 'month'
            ? '本月还没有记录。'
            : '账本还是空的。',
      );
      return;
    }
    if (!(await canShare())) {
      Alert.alert('无法导出', '当前设备不支持系统分享。');
      return;
    }
    setBusy(key);
    try {
      await task(records);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      Alert.alert('导出失败', detail || '请重试。');
    } finally {
      setBusy(null);
    }
  }

  function handleExport(key: FormatKey) {
    if (key === 'xlsx') {
      void run(key, async (rows) => {
        await shareBase64File(buildWorkbookBase64(rows), `${fileBase}.xlsx`, XLSX_MIME);
      });
      return;
    }
    if (key === 'csv') {
      void run(key, async (rows) => {
        await shareTextFile(buildCsv(rows), `${fileBase}.csv`, CSV_MIME);
      });
      return;
    }
    if (key === 'pdf') {
      void run(key, async (rows) => {
        const html = buildReportHtml(rows, {
          title: `截图记账 · ${scopeLabel}`,
          generatedAt: new Date(),
        });
        const { base64 } = await Print.printToFileAsync({ html, base64: true });
        if (!base64) throw new Error('PDF 文件为空');
        await shareBase64File(base64, `${fileBase}.pdf`, PDF_MIME);
      });
      return;
    }
    void run(key, async () => {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await shareImageFile(uri, `${fileBase}.png`);
    });
  }

  if (records == null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>导出范围</Text>
      <ChipGroup
        options={['本月', '全部', '自选']}
        value={scope === 'month' ? '本月' : scope === 'all' ? '全部' : '自选'}
        onChange={(value) =>
          setScope(value === '本月' ? 'month' : value === '全部' ? 'all' : 'custom')
        }
      />

      {scope === 'custom' && allRecords != null ? (
        <View style={styles.pickBlock}>
          <View style={styles.pickHeader}>
            <Text style={styles.pickHeaderLabel}>
              勾选要导出的记录（已选 {selectedIds.length} 项）
            </Text>
            <View style={styles.pickActions}>
              <Pressable hitSlop={6} onPress={selectAll}>
                <Text style={styles.pickAction}>全选</Text>
              </Pressable>
              <Pressable hitSlop={6} onPress={clearSelection}>
                <Text style={styles.pickAction}>清空</Text>
              </Pressable>
            </View>
          </View>
          {allRecords.length === 0 ? (
            <Text style={styles.emptyText}>账本还是空的。</Text>
          ) : (
            allRecords.map((record) => {
              const checked = selectedSet.has(record.id);
              return (
                <Pressable
                  key={record.id}
                  style={styles.pickRow}
                  onPress={() => toggleRecord(record.id)}>
                  <Ionicons
                    name={checked ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={checked ? Colors.primary : Colors.subText}
                  />
                  <View style={styles.pickMain}>
                    <Text style={styles.pickTitle} numberOfLines={1}>
                      {record.merchant || record.category}
                    </Text>
                    <Text style={styles.pickSub} numberOfLines={1}>
                      {record.txTime.replace('T', ' ')} · {record.category}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.pickAmount,
                      record.direction === 'income'
                        ? styles.pickIncome
                        : styles.pickExpense,
                    ]}>
                    {record.direction === 'income' ? '+' : '-'}¥
                    {formatCents(record.amountCents)}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>
      ) : null}

      <View ref={cardRef} collapsable={false} style={styles.card}>
        <Text style={styles.cardTitle}>截图记账 · {scopeLabel}</Text>
        <Text style={styles.cardMeta}>导出时间 {formatStamp(new Date())}</Text>
        <Text style={styles.cardLabel}>支出</Text>
        <Text style={styles.cardExpense}>¥{formatCents(summary.expenseCents)}</Text>
        <Text style={styles.cardMeta}>
          收入 ¥{formatCents(summary.incomeCents)} · 共 {summary.count} 笔
        </Text>
        <View style={styles.cardDivider} />
        {summary.byCategory.length === 0 ? (
          <Text style={styles.cardMeta}>这段时间没有支出记录</Text>
        ) : (
          summary.byCategory.slice(0, 6).map((stat) => (
            <View key={stat.category} style={styles.categoryRow}>
              <View style={[styles.dot, { backgroundColor: categoryColor(stat.category) }]} />
              <Text style={styles.categoryName}>{stat.category}</Text>
              <Text style={styles.categoryAmount}>¥{formatCents(stat.cents)}</Text>
              <Text style={styles.categoryRatio}>{formatRatio(stat.ratio)}</Text>
            </View>
          ))
        )}
      </View>

      <Text style={styles.sectionLabel}>明细预览</Text>
      <View style={styles.card}>
        {records.length === 0 ? (
          <Text style={styles.emptyText}>
            {scope === 'custom' ? '勾选记录后会在这里预览。' : '没有可导出的记录。'}
          </Text>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.tableMin}>
                <View style={[styles.tableRow, styles.tableHead]}>
                  {EXPORT_HEADERS.map((header, index) => (
                    <Text key={header} style={[styles.th, COL_STYLES[index]]}>
                      {header}
                    </Text>
                  ))}
                </View>
                {previewRows.map((record) => {
                  const cells = [
                    record.txTime.replace('T', ' '),
                    record.direction === 'income' ? '收入' : '支出',
                    formatCents(record.amountCents),
                    record.category,
                    record.merchant ?? '',
                    record.platform ?? '',
                    record.note ?? '',
                  ];
                  return (
                    <View key={record.id} style={styles.tableRow}>
                      {cells.map((cell, index) => (
                        <Text
                          key={EXPORT_HEADERS[index]}
                          numberOfLines={1}
                          style={[
                            styles.td,
                            COL_STYLES[index],
                            index === 2 &&
                              (record.direction === 'income'
                                ? styles.pickIncome
                                : styles.pickExpense),
                          ]}>
                          {cell}
                        </Text>
                      ))}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
            <Text style={styles.tableCount}>
              共 {records.length} 笔{records.length > PREVIEW_LIMIT && !expandPreview
                ? '，仅展示前 8 条'
                : ''}
            </Text>
            {records.length > PREVIEW_LIMIT ? (
              <Pressable hitSlop={6} onPress={() => setExpandPreview((value) => !value)}>
                <Text style={styles.pickAction}>
                  {expandPreview ? '收起' : '展开全部'}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>

      <Text style={styles.sectionLabel}>导出格式</Text>
      {FORMATS.map((format) => (
        <Pressable
          key={format.key}
          style={[styles.formatRow, customDisabled && styles.formatRowDisabled]}
          disabled={busy != null || customDisabled}
          onPress={() => handleExport(format.key)}>
          <Ionicons name={format.icon} size={22} color={Colors.primary} />
          <View style={styles.formatMain}>
            <Text style={styles.formatLabel}>{format.label}</Text>
            <Text style={styles.formatDescription}>{format.description}</Text>
          </View>
          {busy === format.key ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Ionicons name="chevron-forward" size={18} color={Colors.subText} />
          )}
        </Pressable>
      ))}

      <Text style={styles.footnote}>导出后走系统分享：微信、邮件、文件管理器都可以。</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl * 2,
  },
  sectionLabel: {
    fontSize: 13,
    color: Colors.subText,
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  pickBlock: {
    marginTop: Spacing.md,
  },
  pickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  pickHeaderLabel: {
    fontSize: 13,
    color: Colors.subText,
  },
  pickActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  pickAction: {
    fontSize: 13,
    color: Colors.primary,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  pickMain: {
    flex: 1,
    marginHorizontal: Spacing.md,
  },
  pickTitle: {
    fontSize: 14,
    color: Colors.text,
  },
  pickSub: {
    fontSize: 11,
    color: Colors.subText,
    marginTop: 1,
  },
  pickAmount: {
    fontSize: 13,
    fontWeight: '600',
  },
  pickExpense: {
    color: Colors.expense,
  },
  pickIncome: {
    color: Colors.income,
  },
  tableMin: {
    minWidth: 480,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  tableHead: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    paddingBottom: 6,
    marginBottom: 2,
  },
  th: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.subText,
  },
  td: {
    fontSize: 11,
    color: Colors.text,
  },
  colTime: {
    width: 96,
  },
  colDir: {
    width: 34,
  },
  colAmount: {
    width: 52,
    textAlign: 'right',
    marginRight: 12,
  },
  colCat: {
    width: 48,
  },
  colWide: {
    flex: 1,
    minWidth: 56,
  },
  colPlat: {
    width: 40,
  },
  tableCount: {
    fontSize: 11,
    color: Colors.subText,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.subText,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    marginTop: Spacing.md,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  cardMeta: {
    fontSize: 12,
    color: Colors.subText,
    marginTop: Spacing.xs,
  },
  cardLabel: {
    fontSize: 13,
    color: Colors.subText,
    marginTop: Spacing.lg,
  },
  cardExpense: {
    fontSize: 30,
    fontWeight: '700',
    color: Colors.text,
    marginTop: Spacing.xs,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginVertical: Spacing.md,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
  },
  categoryName: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
  },
  categoryAmount: {
    fontSize: 13,
    color: Colors.text,
    marginRight: Spacing.md,
  },
  categoryRatio: {
    fontSize: 12,
    color: Colors.subText,
    minWidth: 44,
    textAlign: 'right',
  },
  formatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  formatRowDisabled: {
    opacity: 0.45,
  },
  formatMain: {
    flex: 1,
  },
  formatLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
  },
  formatDescription: {
    fontSize: 12,
    color: Colors.subText,
    marginTop: 2,
  },
  footnote: {
    fontSize: 12,
    color: Colors.subText,
    marginTop: Spacing.md,
  },
});

const COL_STYLES = [
  styles.colTime,
  styles.colDir,
  styles.colAmount,
  styles.colCat,
  styles.colWide,
  styles.colPlat,
  styles.colWide,
];

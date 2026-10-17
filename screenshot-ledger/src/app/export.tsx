import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';

import { ChipGroup } from '@/components/chip-group';
import { categoryColor, Colors, Radius, Spacing } from '@/constants/theme';
import { listRecords, listRecordsByMonth } from '@/db/records';
import { buildCsv, CSV_MIME } from '@/lib/csv';
import { monthKeyOf, monthLabel } from '@/lib/dates';
import {
  canShare,
  copyImageFile,
  readDocumentBase64,
  readDocumentText,
  removeFile,
  requestDocumentFolder,
  requestMediaPermission,
  saveDocumentToFolder,
  saveImageToLibrary,
  shareFile,
  writeBase64File,
  writeTextFile,
} from '@/lib/export';
import { customExportBaseName, exportBaseName } from '@/lib/export-names';
import { EXPORT_HEADERS } from '@/lib/export-columns';
import { formatCents } from '@/lib/money';
import { buildReportHtml, PDF_MIME } from '@/lib/pdf';
import { formatRatio, summarize } from '@/lib/summary';
import type { LedgerRecord } from '@/lib/types';
import type { MonthlySummary } from '@/lib/summary';
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
    description: '明细表格（与 Excel 同列）+ 汇总统计，适合打印',
    icon: 'document-outline',
  },
  {
    key: 'image',
    label: '图片（PNG）',
    description: '汇总卡与明细表格存成一张图，适合发聊天',
    icon: 'image-outline',
  },
];

const PREVIEW_LIMIT = 8;
const IMAGE_ROW_LIMIT = 60;
const MODAL_PREVIEW_LIMIT = 200;

const MIME_BY_KIND: Record<FormatKey, string> = {
  xlsx: XLSX_MIME,
  csv: CSV_MIME,
  pdf: PDF_MIME,
  image: 'image/png',
};

const PREVIEW_HINTS: Record<FormatKey, string> = {
  xlsx: '表格与 .xlsx 文件内容一致；可将文件保存到手机或分享出去',
  csv: '表格与 .csv 文件内容一致；可将文件保存到手机或分享出去',
  pdf: '实际 PDF 中明细表后还附分类占比统计',
  image: '图片内容与实际导出文件一致',
};

const SAVE_FOLDER_KEY = 'ledgerSaveFolderUri';

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
  const [preview, setPreview] = useState<
    { kind: FormatKey; uri: string; fileName: string } | null
  >(null);
  const snapRef = useRef<View>(null);

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
  const captureRows =
    records == null ? [] : records.slice(0, IMAGE_ROW_LIMIT);
  const imageTailNote =
    records != null && records.length > IMAGE_ROW_LIMIT
      ? `其余 ${records.length - IMAGE_ROW_LIMIT} 笔未展示，完整数据可导出 Excel/CSV/PDF`
      : undefined;
  const previewTableRows =
    records == null ? [] : records.slice(0, MODAL_PREVIEW_LIMIT);
  const modalTailNote =
    records != null && records.length > MODAL_PREVIEW_LIMIT
      ? `仅展示前 ${MODAL_PREVIEW_LIMIT} 条，导出文件为完整 ${records.length} 条`
      : undefined;

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

  async function handleExport(key: FormatKey) {
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
    setBusy(key);
    try {
      let uri: string;
      let fileName: string;
      if (key === 'xlsx') {
        fileName = `${fileBase}.xlsx`;
        uri = writeBase64File(buildWorkbookBase64(records), fileName);
      } else if (key === 'csv') {
        fileName = `${fileBase}.csv`;
        uri = writeTextFile(buildCsv(records), fileName);
      } else if (key === 'pdf') {
        const html = buildReportHtml(records, {
          title: `截图记账 · ${scopeLabel}`,
          generatedAt: new Date(),
        });
        const { base64 } = await Print.printToFileAsync({ html, base64: true });
        if (!base64) throw new Error('PDF 文件为空');
        fileName = `${fileBase}.pdf`;
        uri = writeBase64File(base64, fileName);
      } else {
        const shot = await captureRef(snapRef, { format: 'png', quality: 1, result: 'tmpfile' });
        fileName = `${fileBase}.png`;
        uri = copyImageFile(shot, fileName);
      }
      setPreview({ kind: key, uri, fileName });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      Alert.alert('导出失败', detail || '请重试。');
    } finally {
      setBusy(null);
    }
  }

  async function confirmShare() {
    const active = preview;
    if (!active) return;
    if (!(await canShare())) {
      Alert.alert('无法分享', '当前设备不支持系统分享。');
      return;
    }
    try {
      await shareFile(active.uri, MIME_BY_KIND[active.kind]);
      removeFile(active.uri);
      setPreview(null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      Alert.alert('分享失败', detail || '请重试。');
    }
  }

  function cancelPreview() {
    const active = preview;
    if (active) {
      try {
        removeFile(active.uri);
      } catch {}
    }
    setPreview(null);
  }

  async function getSaveFolder(): Promise<string | null> {
    const saved = await AsyncStorage.getItem(SAVE_FOLDER_KEY);
    if (saved) return saved;
    const folderUri = await requestDocumentFolder();
    if (!folderUri) return null;
    await AsyncStorage.setItem(SAVE_FOLDER_KEY, folderUri);
    return folderUri;
  }

  function saveStamp(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  async function confirmSave() {
    const active = preview;
    if (!active) return;
    try {
      if (active.kind === 'image') {
        if (!(await requestMediaPermission())) {
          Alert.alert('无法保存', '需要相册权限才能保存图片，可在系统设置里开启。');
          return;
        }
        await saveImageToLibrary(active.uri);
        removeFile(active.uri);
        setPreview(null);
        Alert.alert('已保存', '图片已存入相册「截图记账」。');
        return;
      }
      const folderUri = await getSaveFolder();
      if (!folderUri) return;
      const dotIndex = active.fileName.lastIndexOf('.');
      const base =
        dotIndex > 0 ? active.fileName.slice(0, dotIndex) : active.fileName;
      const ext = dotIndex > 0 ? active.fileName.slice(dotIndex + 1) : '';
      const saveName = `${base}-${saveStamp(new Date())}${ext ? `.${ext}` : ''}`;
      const isBase64 = active.kind !== 'csv';
      const content = isBase64
        ? await readDocumentBase64(active.uri)
        : await readDocumentText(active.uri);
      await saveDocumentToFolder(folderUri, saveName, MIME_BY_KIND[active.kind], content, isBase64);
      removeFile(active.uri);
      setPreview(null);
      Alert.alert('已保存', `${saveName}\n已保存到所选文件夹。`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      Alert.alert('保存失败', detail || '请重试。');
    }
  }

  if (records == null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <>
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

      <View style={styles.card}>
        <SummaryBlock title={`截图记账 · ${scopeLabel}`} summary={summary} />
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
              <DetailTable rows={previewRows} />
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

      <View ref={snapRef} collapsable={false} style={styles.snapWrap}>
        <View style={styles.card}>
          <SummaryBlock title={`截图记账 · ${scopeLabel}`} summary={summary} />
        </View>
        <View style={[styles.card, styles.snapTable]}>
          <DetailTable rows={captureRows} tailNote={imageTailNote} />
        </View>
      </View>
      </ScrollView>

      <Modal visible={preview != null} animationType="slide" onRequestClose={cancelPreview}>
        <View style={styles.modalRoot}>
          {preview ? (
            <>
              <View style={styles.modalHeader}>
                <Pressable hitSlop={8} onPress={cancelPreview}>
                  <Ionicons name="close" size={22} color={Colors.text} />
                </Pressable>
                <View style={styles.modalTitleWrap}>
                  <Text style={styles.modalTitle} numberOfLines={1}>
                    {preview.fileName}
                  </Text>
                  <Text style={styles.modalHint}>{PREVIEW_HINTS[preview.kind]}</Text>
                </View>
                <View style={styles.modalHeaderSpacer} />
              </View>
              {preview.kind === 'image' ? (
                <Image source={{ uri: preview.uri }} style={styles.modalImage} resizeMode="contain" />
              ) : (
                <ScrollView
                  style={styles.modalBody}
                  contentContainerStyle={styles.modalBodyContent}>
                  <View style={styles.card}>
                    <SummaryBlock title={`截图记账 · ${scopeLabel}`} summary={summary} />
                  </View>
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>明细</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.modalTableScroll}>
                      <DetailTable rows={previewTableRows} tailNote={modalTailNote} />
                    </ScrollView>
                  </View>
                </ScrollView>
              )}
              <View style={styles.modalBar}>
                <Pressable style={styles.shareButton} onPress={() => void confirmShare()}>
                  <Text style={styles.shareButtonText}>分享</Text>
                </Pressable>
                <Pressable style={styles.saveButton} onPress={() => void confirmSave()}>
                  <Text style={styles.saveButtonText}>保存</Text>
                </Pressable>
                <Pressable style={styles.modalCancelButton} onPress={cancelPreview}>
                  <Text style={styles.modalCancelText}>取消</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </Modal>
    </>
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
  snapWrap: {
    position: 'absolute',
    left: -10000,
    top: 0,
    width: 520,
    padding: Spacing.lg,
    backgroundColor: Colors.background,
  },
  snapTable: {
    marginTop: Spacing.md,
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
  modalRoot: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  modalTitleWrap: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  modalHint: {
    fontSize: 12,
    color: Colors.subText,
    marginTop: 2,
  },
  modalHeaderSpacer: {
    width: 22,
  },
  modalImage: {
    flex: 1,
  },
  modalBody: {
    flex: 1,
  },
  modalBodyContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  modalTableScroll: {
    marginTop: Spacing.sm,
  },
  modalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
  shareButton: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  shareButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.primary,
  },
  saveButtonText: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  modalCancelButton: {
    paddingVertical: 12,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  modalCancelText: {
    color: Colors.subText,
    fontSize: 15,
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

function SummaryBlock({ title, summary }: { title: string; summary: MonthlySummary }) {
  return (
    <>
      <Text style={styles.cardTitle}>{title}</Text>
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
    </>
  );
}

function DetailTable({ rows, tailNote }: { rows: LedgerRecord[]; tailNote?: string }) {
  return (
    <View style={styles.tableMin}>
      <View style={[styles.tableRow, styles.tableHead]}>
        {EXPORT_HEADERS.map((header, index) => (
          <Text key={header} style={[styles.th, COL_STYLES[index]]}>
            {header}
          </Text>
        ))}
      </View>
      {rows.map((record) => {
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
      {tailNote ? <Text style={styles.tableCount}>{tailNote}</Text> : null}
    </View>
  );
}

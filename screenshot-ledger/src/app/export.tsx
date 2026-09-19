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
import { exportBaseName } from '@/lib/export-names';
import { formatCents } from '@/lib/money';
import { buildReportHtml, PDF_MIME } from '@/lib/pdf';
import { formatRatio, summarize } from '@/lib/summary';
import type { LedgerRecord } from '@/lib/types';
import { buildWorkbookBase64, XLSX_MIME } from '@/lib/xlsx';

type FormatKey = 'xlsx' | 'csv' | 'pdf' | 'image';
type Scope = 'month' | 'all';

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

  const records = scope === 'month' ? monthRecords : allRecords;
  const summary = summarize(records ?? []);
  const scopeLabel = scope === 'month' ? monthLabel(monthKey) : '全部记录';
  const fileBase = exportBaseName(scope === 'month' ? monthKey : null, new Date());

  async function run(key: FormatKey, task: (rows: LedgerRecord[]) => Promise<void>) {
    if (!records || records.length === 0) {
      Alert.alert('没有可导出的记录', scope === 'month' ? '本月还没有记录。' : '账本还是空的。');
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
        options={['本月', '全部']}
        value={scope === 'month' ? '本月' : '全部'}
        onChange={(value) => setScope(value === '本月' ? 'month' : 'all')}
      />

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

      <Text style={styles.sectionLabel}>导出格式</Text>
      {FORMATS.map((format) => (
        <Pressable
          key={format.key}
          style={styles.formatRow}
          disabled={busy != null}
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

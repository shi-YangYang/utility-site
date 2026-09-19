import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { categoryColor, Colors, Radius, Spacing } from '@/constants/theme';
import { listRecords, listRecordsByMonth } from '@/db/records';
import { monthKeyOf, monthLabel, shiftMonth } from '@/lib/dates';
import { canShare, shareBase64File } from '@/lib/export';
import { formatCents } from '@/lib/money';
import { formatRatio, summarize } from '@/lib/summary';
import type { LedgerRecord } from '@/lib/types';
import { buildWorkbookBase64, exportFileName, XLSX_MIME } from '@/lib/xlsx';

export default function SummaryScreen() {
  const [monthKey, setMonthKey] = useState(() => monthKeyOf(new Date()));
  const [records, setRecords] = useState<LedgerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setLoading(true);
      void (async () => {
        const rows = await listRecordsByMonth(monthKey);
        if (alive) {
          setRecords(rows);
          setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [monthKey]),
  );

  const summary = summarize(records);
  const currentMonthKey = monthKeyOf(new Date());
  const isCurrentMonth = monthKey === currentMonthKey;

  async function exportRecords(scope: 'month' | 'all') {
    try {
      const rows = scope === 'month' ? records : await listRecords();
      if (rows.length === 0) {
        Alert.alert('没有可导出的记录', scope === 'month' ? '本月还没有记录。' : '账本还是空的。');
        return;
      }
      if (!(await canShare())) {
        Alert.alert('无法导出', '当前设备不支持系统分享。');
        return;
      }
      await shareBase64File(
        buildWorkbookBase64(rows),
        exportFileName(scope === 'month' ? monthKey : null, new Date()),
        XLSX_MIME,
      );
    } catch {
      Alert.alert('导出失败', '请重试。');
    }
  }

  function handleExport() {
    Alert.alert('导出 Excel', '选择导出范围', [
      { text: '仅本月', onPress: () => void exportRecords('month') },
      { text: '全部记录', onPress: () => void exportRecords('all') },
      { text: '取消', style: 'cancel' },
    ]);
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.monthRow}>
        <Pressable
          hitSlop={8}
          onPress={() => setMonthKey((key) => shiftMonth(key, -1))}
          style={styles.monthButton}>
          <Ionicons name="chevron-back" size={20} color={Colors.primary} />
        </Pressable>
        <Pressable onPress={() => setMonthKey(currentMonthKey)}>
          <Text style={styles.monthLabel}>{monthLabel(monthKey)}</Text>
        </Pressable>
        <Pressable
          hitSlop={8}
          disabled={isCurrentMonth}
          onPress={() => setMonthKey((key) => shiftMonth(key, 1))}
          style={[styles.monthButton, isCurrentMonth && styles.monthButtonDisabled]}>
          <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>本月支出</Text>
        <Text style={styles.expenseTotal}>¥{formatCents(summary.expenseCents)}</Text>
        <View style={styles.incomeRow}>
          <Text style={styles.incomeLabel}>收入 ¥{formatCents(summary.incomeCents)}</Text>
          <Text style={styles.countLabel}>共 {summary.count} 笔</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>分类支出</Text>
      {loading ? (
        <Text style={styles.emptyText}>加载中…</Text>
      ) : summary.byCategory.length === 0 ? (
        <Text style={styles.emptyText}>这个月还没有支出记录。</Text>
      ) : (
        <View style={styles.card}>
          {summary.byCategory.map((stat) => (
            <View key={stat.category} style={styles.categoryRow}>
              <View style={styles.categoryHeader}>
                <View style={styles.categoryNameWrap}>
                  <View style={[styles.dot, { backgroundColor: categoryColor(stat.category) }]} />
                  <Text style={styles.categoryName}>{stat.category}</Text>
                </View>
                <Text style={styles.categoryAmount}>
                  ¥{formatCents(stat.cents)} · {formatRatio(stat.ratio)}
                </Text>
              </View>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: categoryColor(stat.category),
                      width: `${Math.max(2, Math.round(stat.ratio * 100))}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      <Pressable style={styles.exportButton} onPress={handleExport}>
        <Ionicons name="share-outline" size={16} color={Colors.primary} />
        <Text style={styles.exportText}>导出 Excel</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl * 2,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  monthButton: {
    padding: Spacing.sm,
  },
  monthButtonDisabled: {
    opacity: 0.3,
  },
  monthLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  cardLabel: {
    fontSize: 13,
    color: Colors.subText,
  },
  expenseTotal: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.text,
    marginTop: Spacing.xs,
  },
  incomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
  incomeLabel: {
    fontSize: 13,
    color: Colors.income,
  },
  countLabel: {
    fontSize: 13,
    color: Colors.subText,
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    paddingVertical: 12,
  },
  exportText: {
    color: Colors.primary,
    fontSize: 15,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.subText,
  },
  categoryRow: {
    marginBottom: Spacing.lg,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  categoryNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
  },
  categoryName: {
    fontSize: 15,
    color: Colors.text,
  },
  categoryAmount: {
    fontSize: 13,
    color: Colors.subText,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
});

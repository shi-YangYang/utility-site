import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { RecordRow } from '@/components/record-row';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { listRecords, listRecordsByMonth } from '@/db/records';
import {
  groupRecordsByDay,
  monthKeyOf,
  monthLabel,
  shiftMonth,
} from '@/lib/dates';
import { formatCents } from '@/lib/money';
import type { LedgerRecord } from '@/lib/types';

interface LedgerSection {
  key: string;
  label: string;
  expenseCents: number;
  data: LedgerRecord[];
}

type LedgerScope = 'month' | 'all';

export default function LedgerScreen() {
  const router = useRouter();
  const [scope, setScope] = useState<LedgerScope>('month');
  const [monthKey, setMonthKey] = useState(() => monthKeyOf(new Date()));
  const [sections, setSections] = useState<LedgerSection[]>([]);
  const [hasAny, setHasAny] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    const [monthly, all] = await Promise.all([
      listRecordsByMonth(monthKey),
      listRecords(),
    ]);
    const source = scope === 'all' ? all : monthly;
    setHasAny(all.length > 0);
    setSections(
      groupRecordsByDay(source, new Date()).map((group) => ({
        key: group.dayKey,
        label: group.label,
        expenseCents: group.expenseCents,
        data: group.records,
      })),
    );
  }, [scope, monthKey]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        await reload();
        if (alive) setLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [reload]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!hasAny) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>还没有账目</Text>
        <Text style={styles.emptyText}>把京东、淘宝、拼多多的付款截图丢进来，自动识别记账。</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.push('/add')}>
          <Text style={styles.primaryButtonText}>选截图记一笔</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => router.push('/manual')}>
          <Text style={styles.secondaryButtonText}>手动记一笔</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SectionList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      sections={sections}
      keyExtractor={(item) => String(item.id)}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
      }
      ListHeaderComponent={
        <View style={styles.filterRow}>
          <View style={styles.monthNav}>
            <Pressable
              hitSlop={8}
              disabled={scope === 'all'}
              onPress={() => setMonthKey(shiftMonth(monthKey, -1))}>
              <Ionicons
                name="chevron-back"
                size={18}
                color={scope === 'all' ? Colors.subText : Colors.primary}
              />
            </Pressable>
            <Text style={[styles.monthTitle, scope === 'all' && styles.monthTitleDim]}>
              {monthLabel(monthKey)}
            </Text>
            <Pressable
              hitSlop={8}
              disabled={scope === 'all' || monthKey >= monthKeyOf(new Date())}
              onPress={() => setMonthKey(shiftMonth(monthKey, 1))}>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={
                  scope === 'all' || monthKey >= monthKeyOf(new Date())
                    ? Colors.subText
                    : Colors.primary
                }
              />
            </Pressable>
          </View>
          <Pressable
            onPress={() => setScope(scope === 'all' ? 'month' : 'all')}
            style={[styles.allChip, scope === 'all' && styles.allChipSelected]}>
            <Text style={[styles.allChipText, scope === 'all' && styles.allChipTextSelected]}>
              全部
            </Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.monthEmpty}>
          {scope === 'month'
            ? `${monthLabel(monthKey)}没有记录，切换月份或看看「全部」。`
            : '没有记录。'}
        </Text>
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>{section.label}</Text>
          {section.expenseCents > 0 ? (
            <Text style={styles.sectionTotal}>支出 ¥{formatCents(section.expenseCents)}</Text>
          ) : null}
        </View>
      )}
      renderItem={({ item }) => (
        <RecordRow record={item} onPress={() => router.push(`/record/${item.id}`)} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    padding: Spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.subText,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: Spacing.xl,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    marginBottom: Spacing.md,
  },
  primaryButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: Colors.primary,
    fontSize: 15,
  },
  list: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  listContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl * 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  sectionTotal: {
    fontSize: 12,
    color: Colors.subText,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    minWidth: 92,
    textAlign: 'center',
  },
  monthTitleDim: {
    color: Colors.subText,
  },
  allChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  allChipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  allChipText: {
    fontSize: 14,
    color: Colors.text,
  },
  allChipTextSelected: {
    color: Colors.primary,
    fontWeight: '600',
  },
  monthEmpty: {
    fontSize: 14,
    color: Colors.subText,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
});

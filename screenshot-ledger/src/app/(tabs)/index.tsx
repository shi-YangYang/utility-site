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
import { listRecords } from '@/db/records';
import { groupRecordsByDay } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import type { LedgerRecord } from '@/lib/types';

interface LedgerSection {
  key: string;
  label: string;
  expenseCents: number;
  data: LedgerRecord[];
}

export default function LedgerScreen() {
  const router = useRouter();
  const [sections, setSections] = useState<LedgerSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    const records = await listRecords();
    setSections(
      groupRecordsByDay(records, new Date()).map((group) => ({
        key: group.dayKey,
        label: group.label,
        expenseCents: group.expenseCents,
        data: group.records,
      })),
    );
  }, []);

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

  if (sections.length === 0) {
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
});

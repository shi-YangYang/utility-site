import { Pressable, StyleSheet, Text, View } from 'react-native';

import { categoryColor, Colors, Radius, Spacing } from '@/constants/theme';
import { formatSignedCents } from '@/lib/money';
import type { LedgerRecord } from '@/lib/types';

interface RecordRowProps {
  record: LedgerRecord;
  onPress: () => void;
}

export function RecordRow({ record, onPress }: RecordRowProps) {
  const title = record.merchant || record.category;
  const time = record.txTime.slice(11, 16);

  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={[styles.dot, { backgroundColor: categoryColor(record.category) }]} />
      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {time} · {record.category}
          {record.payMethod ? ` · ${record.payMethod}` : ''}
        </Text>
      </View>
      <Text
        style={[
          styles.amount,
          record.direction === 'income' ? styles.income : styles.expense,
        ]}>
        {formatSignedCents(record.amountCents, record.direction)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: Spacing.md,
  },
  main: {
    flex: 1,
    marginRight: Spacing.md,
  },
  title: {
    fontSize: 16,
    color: Colors.text,
    fontWeight: '500',
  },
  subtitle: {
    fontSize: 12,
    color: Colors.subText,
    marginTop: 2,
  },
  amount: {
    fontSize: 16,
    fontWeight: '600',
  },
  expense: {
    color: Colors.expense,
  },
  income: {
    color: Colors.income,
  },
});

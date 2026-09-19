import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import type { Direction } from '@/lib/types';

interface DraftCardProps {
  imageUri: string;
  title: string;
  subtitle: string;
  amountText: string;
  direction: Direction;
  badges: string[];
  excluded: boolean;
  hasError: boolean;
  busy?: boolean;
  onPress: () => void;
  onToggleExclude: () => void;
  onRetry: () => void;
  onManual: () => void;
}

export function DraftCard({
  imageUri,
  title,
  subtitle,
  amountText,
  direction,
  badges,
  excluded,
  hasError,
  busy = false,
  onPress,
  onToggleExclude,
  onRetry,
  onManual,
}: DraftCardProps) {
  return (
    <View style={[styles.card, excluded && styles.cardExcluded]}>
      <Pressable style={styles.main} onPress={onPress} disabled={busy}>
        <Image source={{ uri: imageUri }} style={styles.thumb} contentFit="cover" />
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.subtitle, hasError && styles.subtitleError]} numberOfLines={2}>
            {subtitle}
          </Text>
          {badges.length > 0 ? (
            <View style={styles.badgeRow}>
              {badges.map((badge) => (
                <Text key={badge} style={styles.badge}>
                  {badge}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
        <Text
          style={[styles.amount, direction === 'income' ? styles.income : styles.expense]}>
          {amountText}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.busyText}>正在识别…</Text>
          </View>
        ) : hasError ? (
          <>
            <Pressable onPress={onRetry} hitSlop={8}>
              <Text style={styles.action}>重试</Text>
            </Pressable>
            <Pressable onPress={onManual} hitSlop={8}>
              <Text style={styles.action}>手动填写</Text>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={onToggleExclude} hitSlop={8}>
            <Text style={styles.action}>{excluded ? '恢复保存' : '忽略这张'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  cardExcluded: {
    opacity: 0.55,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumb: {
    width: 52,
    height: 68,
    borderRadius: Radius.sm,
    backgroundColor: Colors.border,
    marginRight: Spacing.md,
  },
  info: {
    flex: 1,
    marginRight: Spacing.md,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.subText,
    marginTop: 2,
    lineHeight: 17,
  },
  subtitleError: {
    color: Colors.danger,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  badge: {
    fontSize: 11,
    color: '#8A5A00',
    backgroundColor: '#FFF3D6',
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  amount: {
    fontSize: 15,
    fontWeight: '600',
  },
  expense: {
    color: Colors.expense,
  },
  income: {
    color: Colors.income,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.lg,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  action: {
    fontSize: 13,
    color: Colors.primary,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  busyText: {
    fontSize: 13,
    color: Colors.subText,
  },
});

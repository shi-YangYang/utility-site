import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';

interface ChipGroupProps {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  allowClear?: boolean;
}

export function ChipGroup({ options, value, onChange, allowClear }: ChipGroupProps) {
  return (
    <View style={styles.wrap}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(selected && allowClear ? '' : option)}
            style={[styles.chip, selected && styles.chipSelected]}>
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  chipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  chipText: {
    fontSize: 14,
    color: Colors.text,
  },
  chipTextSelected: {
    color: Colors.primary,
    fontWeight: '600',
  },
});

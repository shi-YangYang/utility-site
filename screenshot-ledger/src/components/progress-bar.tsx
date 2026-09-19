import { StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';

interface ProgressBarProps {
  ratio: number;
  color?: string;
}

export function ProgressBar({ ratio, color = Colors.primary }: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${percent}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
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

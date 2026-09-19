import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RecordForm } from '@/components/record-form';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  countRecordsWithImageHash,
  deleteRecord,
  getRecord,
  updateRecord,
} from '@/db/records';
import { formValuesFromRecord, type ValidatedForm } from '@/lib/form';
import { deleteImageFile } from '@/lib/image';
import type { LedgerRecord } from '@/lib/types';

export default function RecordDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const recordId = Number(params.id);
  const [record, setRecord] = useState<LedgerRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const found = Number.isFinite(recordId) ? await getRecord(recordId) : null;
        if (alive) setRecord(found);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [recordId]);

  async function handleSave(value: ValidatedForm) {
    if (!record) return;
    try {
      await updateRecord(record.id, {
        ...value,
        imagePath: record.imagePath,
        imageHash: record.imageHash,
      });
      router.back();
    } catch {
      Alert.alert('保存失败', '请重试。');
    }
  }

  async function performDelete() {
    if (!record) return;
    try {
      await deleteRecord(record.id);
      if (record.imageHash) {
        const remaining = await countRecordsWithImageHash(record.imageHash);
        if (remaining === 0) deleteImageFile(record.imagePath);
      }
      router.back();
    } catch {
      Alert.alert('删除失败', '请重试。');
    }
  }

  function confirmDelete() {
    if (!record) return;
    Alert.alert('删除这条记录？', '删除后不可恢复。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void performDelete() },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!record) {
    return (
      <View style={styles.center}>
        <Text style={styles.missing}>记录不存在或已被删除。</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <RecordForm
        initial={formValuesFromRecord(record)}
        imageUri={record.imagePath}
        submitLabel="保存修改"
        onSubmit={handleSave}
      />
      <Pressable
        style={[styles.deleteButton, { marginBottom: Spacing.lg + insets.bottom }]}
        onPress={confirmDelete}>
        <Text style={styles.deleteText}>删除这条记录</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  wrap: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  missing: {
    fontSize: 15,
    color: Colors.subText,
  },
  deleteButton: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.danger,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: Colors.card,
  },
  deleteText: {
    color: Colors.danger,
    fontSize: 15,
    fontWeight: '500',
  },
});

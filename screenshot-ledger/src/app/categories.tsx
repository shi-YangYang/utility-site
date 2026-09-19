import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { categoryColor, Colors, Radius, Spacing } from '@/constants/theme';
import { addCategory, listCategories, removeCategory } from '@/db/categories';
import { DEFAULT_CATEGORY, MAX_CATEGORY_LENGTH } from '@/lib/categories';

export default function CategoriesScreen() {
  const [categories, setCategories] = useState<string[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();

  const reload = useCallback(async () => {
    setCategories(await listCategories());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleAdd() {
    setBusy(true);
    const result = await addCategory(draft);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft('');
    setError(null);
    await reload();
  }

  async function performRemove(name: string) {
    await removeCategory(name);
    await reload();
  }

  function confirmRemove(name: string) {
    if (name === DEFAULT_CATEGORY) {
      Alert.alert('「其他」不可删除', '识别失败时会默认归入这个分类。');
      return;
    }
    Alert.alert(`删除分类「${name}」？`, '只从选择列表移除，已有记录的分类不变。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void performRemove(name) },
    ]);
  }

  if (categories == null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.xl * 2 + insets.bottom }]}
        keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>新增分类</Text>
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              if (error) setError(null);
            }}
            placeholder={`最多 ${MAX_CATEGORY_LENGTH} 个字，如：宠物`}
            placeholderTextColor={Colors.subText}
            maxLength={20}
            returnKeyType="done"
            onSubmitEditing={() => void handleAdd()}
          />
          <Pressable
            style={[styles.addButton, busy && styles.addButtonDisabled]}
            disabled={busy}
            onPress={() => void handleAdd()}>
            {busy ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.addButtonText}>添加</Text>
            )}
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.sectionLabel}>现有分类</Text>
        {categories.map((name) => (
          <View key={name} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: categoryColor(name) }]} />
            <Text style={styles.name}>{name}</Text>
            {name === DEFAULT_CATEGORY ? (
              <Text style={styles.locked}>默认</Text>
            ) : (
              <Pressable hitSlop={8} onPress={() => confirmRemove(name)}>
                <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              </Pressable>
            )}
          </View>
        ))}
        <Text style={styles.footnote}>删除分类不影响已有记录，只在记账时可选的列表里移除。</Text>
      </ScrollView>
    </KeyboardAvoidingView>
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
  content: {
    padding: Spacing.lg,
  },
  sectionLabel: {
    fontSize: 13,
    color: Colors.subText,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  addRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: 16,
    color: Colors.text,
  },
  addButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonDisabled: {
    opacity: 0.6,
  },
  addButtonText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  error: {
    color: Colors.danger,
    fontSize: 13,
    marginTop: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.md,
  },
  name: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
  },
  locked: {
    fontSize: 12,
    color: Colors.subText,
  },
  footnote: {
    fontSize: 12,
    color: Colors.subText,
    marginTop: Spacing.sm,
  },
});

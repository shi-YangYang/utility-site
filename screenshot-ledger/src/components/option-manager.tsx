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

interface OptionManagerProps {
  placeholder: string;
  load: () => Promise<string[]>;
  add: (input: string) => Promise<{ ok: true; name: string } | { ok: false; error: string }>;
  remove: (name: string) => Promise<void>;
  protectedName?: string;
  protectedTitle?: string;
  protectedMessage?: string;
}

export function OptionManager({
  placeholder,
  load,
  add,
  remove,
  protectedName,
  protectedTitle,
  protectedMessage,
}: OptionManagerProps) {
  const [items, setItems] = useState<string[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();

  const reload = useCallback(async () => {
    setItems(await load());
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleAdd() {
    setBusy(true);
    const result = await add(draft);
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
    await remove(name);
    await reload();
  }

  function confirmRemove(name: string) {
    if (protectedName && name === protectedName) {
      Alert.alert(protectedTitle ?? '该项不可删除', protectedMessage ?? '');
      return;
    }
    Alert.alert(`删除「${name}」？`, '只从选择列表移除，已有记录不变。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void performRemove(name) },
    ]);
  }

  if (items == null) {
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
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              if (error) setError(null);
            }}
            placeholder={placeholder}
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

        <View style={styles.list}>
          {items.map((name) => (
            <View key={name} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: categoryColor(name) }]} />
              <Text style={styles.name}>{name}</Text>
              {name === protectedName ? (
                <Text style={styles.locked}>默认</Text>
              ) : (
                <Pressable hitSlop={8} onPress={() => confirmRemove(name)}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </Pressable>
              )}
            </View>
          ))}
        </View>

        <Text style={styles.footnote}>删除只影响记账时的可选列表，已有记录不受影响。</Text>
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
  addRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
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
  list: {
    marginTop: Spacing.lg,
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
    marginTop: Spacing.lg,
  },
});

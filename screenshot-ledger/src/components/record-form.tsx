import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { CATEGORIES, PAY_METHODS, PLATFORMS } from '@/lib/categories';
import { validateFormValues, type RecordFormValues, type ValidatedForm } from '@/lib/form';
import type { Direction } from '@/lib/types';

import { ChipGroup } from './chip-group';

interface RecordFormProps {
  initial: RecordFormValues;
  imageUri?: string | null;
  submitLabel: string;
  busy?: boolean;
  duplicateHint?: boolean;
  timeInferred?: boolean;
  secondaryAction?: { label: string; onPress: () => void };
  onSubmit: (value: ValidatedForm, values: RecordFormValues) => void | Promise<void>;
}

export function RecordForm({
  initial,
  imageUri,
  submitLabel,
  busy = false,
  duplicateHint = false,
  timeInferred = false,
  secondaryAction,
  onSubmit,
}: RecordFormProps) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [showTimeHint, setShowTimeHint] = useState(timeInferred);

  function patch(changes: Partial<RecordFormValues>) {
    setValues((prev) => ({ ...prev, ...changes }));
  }

  function handleSubmit() {
    const result = validateFormValues(values);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    void onSubmit(result.value, values);
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.preview} contentFit="cover" />
      ) : null}

      {duplicateHint ? (
        <View style={styles.hint}>
          <Text style={styles.hintText}>这张截图可能已经记过账，确认不是重复后再保存。</Text>
        </View>
      ) : null}

      <Text style={styles.label}>金额</Text>
      <View style={styles.amountRow}>
        <Text style={styles.amountPrefix}>¥</Text>
        <TextInput
          style={styles.amountInput}
          value={values.amount}
          onChangeText={(text) => patch({ amount: text })}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={Colors.subText}
        />
      </View>

      <Text style={styles.label}>方向</Text>
      <View style={styles.directionRow}>
        {(
          [
            { key: 'expense' as Direction, label: '支出' },
            { key: 'income' as Direction, label: '收入' },
          ]
        ).map((item) => {
          const selected = values.direction === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => patch({ direction: item.key })}
              style={[
                styles.directionButton,
                selected && item.key === 'income' ? styles.directionIncome : null,
                selected && item.key === 'expense' ? styles.directionExpense : null,
              ]}>
              <Text style={[styles.directionText, selected && styles.directionTextSelected]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>商户 / 收款方</Text>
      <TextInput
        style={styles.input}
        value={values.merchant}
        onChangeText={(text) => patch({ merchant: text })}
        placeholder="如：肯德基"
        placeholderTextColor={Colors.subText}
      />

      <Text style={styles.label}>分类</Text>
      <ChipGroup
        options={CATEGORIES}
        value={values.category}
        onChange={(category) => patch({ category })}
      />

      <Text style={styles.label}>支付方式</Text>
      <ChipGroup
        options={PAY_METHODS}
        value={values.payMethod}
        onChange={(payMethod) => patch({ payMethod })}
        allowClear
      />

      <Text style={styles.label}>平台</Text>
      <ChipGroup
        options={PLATFORMS}
        value={values.platform}
        onChange={(platform) => patch({ platform })}
        allowClear
      />

      <Text style={styles.label}>时间</Text>
      <TextInput
        style={styles.input}
        value={values.txTime}
        onChangeText={(text) => {
          patch({ txTime: text });
          if (showTimeHint) setShowTimeHint(false);
        }}
        placeholder="2026-09-18 12:30"
        placeholderTextColor={Colors.subText}
        autoCapitalize="none"
      />
      {showTimeHint ? (
        <Text style={styles.fieldHint}>未识别到时间，已按现在填写，请确认或修改。</Text>
      ) : null}

      <Text style={styles.label}>备注</Text>
      <TextInput
        style={[styles.input, styles.noteInput]}
        value={values.note}
        onChangeText={(text) => patch({ note: text })}
        placeholder="订单号、商品摘要等（可不填）"
        placeholderTextColor={Colors.subText}
        multiline
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        onPress={handleSubmit}
        disabled={busy}
        style={[styles.submit, busy && styles.submitDisabled]}>
        {busy ? (
          <ActivityIndicator color={Colors.white} />
        ) : (
          <Text style={styles.submitText}>{submitLabel}</Text>
        )}
      </Pressable>

      {secondaryAction ? (
        <Pressable onPress={secondaryAction.onPress} disabled={busy} style={styles.secondary}>
          <Text style={styles.secondaryText}>{secondaryAction.label}</Text>
        </Pressable>
      ) : null}
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
  preview: {
    width: '100%',
    height: 220,
    borderRadius: Radius.md,
    marginBottom: Spacing.lg,
    backgroundColor: Colors.border,
  },
  hint: {
    backgroundColor: '#FFF7E6',
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  hintText: {
    color: '#8A5A00',
    fontSize: 13,
    lineHeight: 19,
  },
  label: {
    fontSize: 13,
    color: Colors.subText,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
    paddingBottom: Spacing.sm,
  },
  amountPrefix: {
    fontSize: 28,
    fontWeight: '600',
    color: Colors.text,
    marginRight: Spacing.sm,
  },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '600',
    color: Colors.text,
    padding: 0,
  },
  directionRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  directionButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    alignItems: 'center',
  },
  directionExpense: {
    borderColor: Colors.expense,
    backgroundColor: '#FDECEC',
  },
  directionIncome: {
    borderColor: Colors.income,
    backgroundColor: '#E7F6EE',
  },
  directionText: {
    fontSize: 15,
    color: Colors.text,
  },
  directionTextSelected: {
    fontWeight: '600',
  },
  input: {
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: 16,
    color: Colors.text,
  },
  noteInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  error: {
    color: Colors.danger,
    fontSize: 14,
    marginTop: Spacing.md,
  },
  fieldHint: {
    color: '#B45309',
    fontSize: 12,
    marginTop: Spacing.xs,
  },
  submit: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  secondary: {
    marginTop: Spacing.md,
    borderRadius: Radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  secondaryText: {
    color: Colors.subText,
    fontSize: 15,
  },
});

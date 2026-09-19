import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DraftCard } from '@/components/draft-card';
import { ProgressBar } from '@/components/progress-bar';
import { RecordForm } from '@/components/record-form';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { countRecordsWithImageHash, insertRecord } from '@/db/records';
import { listCategories } from '@/db/categories';
import { getLlmConfig, MISSING_CONFIG_MESSAGE } from '@/lib/config';
import {
  emptyFormValues,
  formValuesFromExtraction,
  validateFormValues,
  type RecordFormValues,
  type ValidatedForm,
} from '@/lib/form';
import { persistImage, pickImages, prepareImage, type PreparedImage } from '@/lib/image';
import { recognizeImage, userMessageForLlmError } from '@/lib/llm';
import type { LlmConfig, LlmExtraction } from '@/lib/types';

type Phase = 'intro' | 'recognizing' | 'review' | 'edit' | 'saving';

type StepStatus = 'pending' | 'preparing' | 'recognizing' | 'ready' | 'failed' | 'saving' | 'saved';

interface Step {
  asset: ImagePickerAsset;
  prepared: PreparedImage | null;
  extraction: LlmExtraction | null;
  values: RecordFormValues | null;
  timeInferred: boolean;
  duplicate: boolean;
  error: string | null;
  excluded: boolean;
  status: StepStatus;
}

function isSavable(step: Step): boolean {
  if (step.excluded || !step.values) return false;
  if (step.status === 'failed' || step.status === 'saved') return false;
  return validateFormValues(step.values).ok;
}

function statusText(status: StepStatus): string {
  switch (status) {
    case 'pending':
      return '等待识别';
    case 'preparing':
      return '正在处理图片…';
    case 'recognizing':
      return '正在识别…';
    case 'ready':
      return '识别完成';
    case 'failed':
      return '识别失败';
    case 'saving':
      return '正在保存…';
    case 'saved':
      return '已保存';
  }
}

export default function AddScreen() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [steps, setSteps] = useState<Step[]>([]);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [saveTotal, setSaveTotal] = useState(0);
  const configRef = useRef<LlmConfig | null>(null);
  const insets = useSafeAreaInsets();

  const total = steps.length;
  const readyCount = steps.filter(isSavable).length;
  const ignoredCount = steps.filter((step) => step.excluded && step.status === 'ready').length;

  function patchStep(target: number, changes: Partial<Step>) {
    setSteps((prev) => prev.map((item, i) => (i === target ? { ...item, ...changes } : item)));
  }

  async function processOne(
    target: number,
    asset: ImagePickerAsset,
    config: LlmConfig,
  ): Promise<boolean> {
    patchStep(target, { status: 'preparing', error: null });
    let prepared: PreparedImage;
    try {
      prepared = await prepareImage(asset);
    } catch {
      patchStep(target, {
        status: 'failed',
        error: '图片处理失败，可以重试或手动填写。',
        excluded: true,
      });
      return false;
    }
    patchStep(target, { prepared, status: 'recognizing' });
    try {
      const categories = await listCategories();
      const extraction = await recognizeImage(prepared.base64, config, { categories });
      const duplicate =
        extraction.isPayment && (await countRecordsWithImageHash(prepared.hash)) > 0;
      patchStep(target, {
        extraction,
        duplicate,
        timeInferred: extraction.isPayment && extraction.txTime == null,
        values: formValuesFromExtraction(extraction),
        excluded: !extraction.isPayment,
        error: null,
        status: 'ready',
      });
      return extraction.isPayment;
    } catch (error) {
      patchStep(target, {
        status: 'failed',
        error: userMessageForLlmError(error),
        excluded: true,
      });
      return false;
    }
  }

  async function chooseImages() {
    const config = getLlmConfig();
    if (!config) {
      Alert.alert('无法识别', MISSING_CONFIG_MESSAGE);
      return;
    }
    const assets = await pickImages();
    if (assets.length === 0) return;
    configRef.current = config;
    const list: Step[] = assets.map((asset) => ({
      asset,
      prepared: null,
      extraction: null,
      values: null,
      timeInferred: false,
      duplicate: false,
      error: null,
      excluded: false,
      status: 'pending',
    }));
    setSteps(list);
    setEditIndex(null);
    setPhase('recognizing');

    let singleReady = false;
    for (let i = 0; i < list.length; i += 1) {
      const ready = await processOne(i, list[i].asset, config);
      if (list.length === 1 && ready) singleReady = true;
    }

    if (singleReady) {
      setEditIndex(0);
      setPhase('edit');
    } else {
      setPhase('review');
    }
  }

  async function retryStep(index: number) {
    const config = configRef.current;
    if (!config || !steps[index]) return;
    await processOne(index, steps[index].asset, config);
  }

  function manualFill(index: number) {
    patchStep(index, {
      values: emptyFormValues(),
      extraction: null,
      timeInferred: false,
      duplicate: false,
      error: null,
      excluded: false,
      status: 'ready',
    });
    setEditIndex(index);
    setPhase('edit');
  }

  function toggleExclude(index: number) {
    patchStep(index, { excluded: !steps[index].excluded });
  }

  async function saveSingle(index: number, validated: ValidatedForm) {
    const step = steps[index];
    if (!step) return;
    setSaveTotal(1);
    setSavedCount(0);
    setPhase('saving');
    try {
      const imagePath = step.prepared ? await persistImage(step.prepared) : null;
      await insertRecord({
        ...validated,
        imagePath,
        imageHash: step.prepared?.hash ?? null,
      });
      router.back();
    } catch {
      setPhase('edit');
      Alert.alert('保存失败', '请重试。');
    }
  }

  async function saveAll() {
    const targets = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => isSavable(step));
    if (targets.length === 0) return;
    setSaveTotal(targets.length);
    setSavedCount(0);
    setPhase('saving');

    let failures = 0;
    for (const { step, index } of targets) {
      const validated = validateFormValues(step.values as RecordFormValues);
      if (!validated.ok) {
        failures += 1;
        patchStep(index, { error: validated.error, excluded: true });
        continue;
      }
      try {
        const imagePath = step.prepared ? await persistImage(step.prepared) : null;
        await insertRecord({
          ...validated.value,
          imagePath,
          imageHash: step.prepared?.hash ?? null,
        });
        patchStep(index, { status: 'saved' });
        setSavedCount((count) => count + 1);
      } catch {
        failures += 1;
        patchStep(index, { status: 'ready', error: '保存失败，请重试。' });
      }
    }

    if (failures > 0) {
      Alert.alert('部分保存失败', `有 ${failures} 张没有保存成功，请检查后重试。`);
      setPhase('review');
    } else {
      router.back();
    }
  }

  function handleEditSubmit(validated: ValidatedForm, values: RecordFormValues) {
    const target = editIndex;
    if (target == null) return;
    if (total === 1) {
      patchStep(target, { values, timeInferred: false, excluded: false, error: null });
      void saveSingle(target, validated);
      return;
    }
    patchStep(target, {
      values,
      timeInferred: false,
      excluded: false,
      error: null,
      status: 'ready',
    });
    setEditIndex(null);
    setPhase('review');
  }

  if (phase === 'intro' || total === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="images-outline" size={56} color={Colors.primary} />
        <Text style={styles.title}>导入付款截图</Text>
        <Text style={styles.text}>
          支持京东、淘宝、拼多多、微信、支付宝等付款截图，一次最多 10 张。
          单张识别后直接确认；多张会先全部识别，再统一核对保存。
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => void chooseImages()}>
          <Text style={styles.primaryButtonText}>选择截图</Text>
        </Pressable>
        <Pressable style={styles.textButton} onPress={() => router.replace('/manual')}>
          <Text style={styles.textButtonText}>手动记一笔</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'recognizing') {
    const done = steps.filter(
      (step) => step.status === 'ready' || step.status === 'failed',
    ).length;
    return (
      <View style={styles.wrap}>
        <View style={styles.progressHeader}>
          <View style={styles.progressHeaderRow}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.headerText}>
              正在识别第 {Math.min(done + 1, total)} / {total} 张
            </Text>
          </View>
          <ProgressBar ratio={total > 0 ? done / total : 0} />
          <Text style={styles.progressHint}>
            已识别 {done} / {total} 张
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.listContent}>
          {steps.map((step, index) => (
            <View key={index} style={styles.progressRow}>
              <Image
                source={{ uri: step.prepared?.uri ?? step.asset.uri }}
                style={styles.progressThumb}
                contentFit="cover"
              />
              <View style={styles.progressMain}>
                <Text style={styles.progressTitle}>第 {index + 1} 张</Text>
                <Text style={styles.progressStatus}>{statusText(step.status)}</Text>
              </View>
              {step.status === 'preparing' || step.status === 'recognizing' ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : null}
              {step.status === 'ready' ? (
                <Ionicons name="checkmark-circle" size={20} color={Colors.income} />
              ) : null}
              {step.status === 'failed' ? (
                <Ionicons name="alert-circle" size={20} color={Colors.danger} />
              ) : null}
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (phase === 'saving') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.progress}>
          正在保存 {savedCount} / {saveTotal} 笔…
        </Text>
        <View style={styles.saveProgress}>
          <ProgressBar
            ratio={saveTotal > 0 ? savedCount / saveTotal : 0}
            color={Colors.income}
          />
        </View>
      </View>
    );
  }

  if (phase === 'edit' && editIndex != null && steps[editIndex]) {
    const step = steps[editIndex];
    return (
      <View style={styles.formWrap}>
        <Text style={styles.progressBar}>
          第 {editIndex + 1} / {total} 张
        </Text>
        <RecordForm
          key={`${editIndex}-${step.extraction ? 'auto' : 'manual'}`}
          initial={step.values ?? emptyFormValues()}
          imageUri={step.prepared?.uri ?? step.asset.uri}
          submitLabel={total === 1 ? '保存' : '确定修改'}
          timeInferred={step.timeInferred}
          duplicateHint={step.duplicate}
          secondaryAction={
            total === 1 ? { label: '跳过这张', onPress: () => router.back() } : undefined
          }
          onSubmit={handleEditSubmit}
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.listContent}>
        <Text style={styles.reviewHint}>
          识别完成。点击卡片可修改，「忽略这张」的不会保存。
        </Text>
        {steps.map((step, index) => {
          const values = step.values;
          const badges: string[] = [];
          if (step.extraction && !step.extraction.isPayment) badges.push('不是付款截图');
          if (step.timeInferred) badges.push('时间待确认');
          if (step.duplicate) badges.push('可能已记过');
          return (
            <DraftCard
              key={index}
              imageUri={step.prepared?.uri ?? step.asset.uri}
              title={values?.merchant || values?.category || `第 ${index + 1} 张`}
              subtitle={
                step.error ??
                (values
                  ? [values.txTime, values.category, values.platform]
                      .filter(Boolean)
                      .join(' · ')
                  : '待处理')
              }
              amountText={
                values?.amount
                  ? `${values.direction === 'income' ? '+' : '-'}¥${values.amount}`
                  : '—'
              }
              direction={values?.direction ?? 'expense'}
              badges={badges}
              excluded={step.excluded || step.status === 'saved'}
              hasError={step.error != null}
              busy={step.status === 'preparing' || step.status === 'recognizing'}
              onPress={() => {
                setEditIndex(index);
                setPhase('edit');
              }}
              onToggleExclude={() => toggleExclude(index)}
              onRetry={() => void retryStep(index)}
              onManual={() => manualFill(index)}
            />
          );
        })}
      </ScrollView>
      <View style={[styles.bottomBar, { paddingBottom: Spacing.md + insets.bottom }]}>
        {ignoredCount > 0 ? (
          <Text style={styles.ignoredText}>已忽略 {ignoredCount} 张</Text>
        ) : null}
        <Pressable
          disabled={readyCount === 0}
          onPress={() => void saveAll()}
          style={[styles.saveButton, readyCount === 0 && styles.saveButtonDisabled]}>
          <Text style={styles.saveButtonText}>保存 {readyCount} 笔</Text>
        </Pressable>
      </View>
    </View>
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
  wrap: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  formWrap: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  text: {
    fontSize: 14,
    color: Colors.subText,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: Spacing.lg,
  },
  progress: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    marginTop: Spacing.lg,
  },
  progressBar: {
    fontSize: 13,
    color: Colors.subText,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    marginTop: Spacing.sm,
    minWidth: 160,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  textButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    marginTop: Spacing.sm,
  },
  textButtonText: {
    color: Colors.primary,
    fontSize: 15,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  progressHeader: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  progressHint: {
    fontSize: 12,
    color: Colors.subText,
    textAlign: 'center',
  },
  saveProgress: {
    width: '80%',
    marginTop: Spacing.md,
  },
  headerText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  listContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  progressThumb: {
    width: 40,
    height: 52,
    borderRadius: Radius.sm,
    backgroundColor: Colors.border,
    marginRight: Spacing.md,
  },
  progressMain: {
    flex: 1,
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  progressStatus: {
    fontSize: 12,
    color: Colors.subText,
    marginTop: 2,
  },
  reviewHint: {
    fontSize: 13,
    color: Colors.subText,
    marginBottom: Spacing.md,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
  ignoredText: {
    fontSize: 13,
    color: Colors.subText,
  },
  saveButton: {
    flex: 1,
    marginLeft: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
});

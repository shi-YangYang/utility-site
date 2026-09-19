import { router } from 'expo-router';
import { Alert } from 'react-native';

import { RecordForm } from '@/components/record-form';
import { insertRecord } from '@/db/records';
import { emptyFormValues, type ValidatedForm } from '@/lib/form';

export default function ManualScreen() {
  async function handleSubmit(value: ValidatedForm) {
    try {
      await insertRecord({ ...value, imagePath: null, imageHash: null });
      router.back();
    } catch {
      Alert.alert('保存失败', '请重试。');
    }
  }

  return <RecordForm initial={emptyFormValues()} submitLabel="保存" onSubmit={handleSubmit} />;
}

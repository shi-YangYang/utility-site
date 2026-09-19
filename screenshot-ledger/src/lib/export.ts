import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function canShare(): Promise<boolean> {
  return Sharing.isAvailableAsync();
}

export async function shareBase64File(
  base64: string,
  fileName: string,
  mimeType: string,
): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(base64, { encoding: 'base64' });
  await Sharing.shareAsync(file.uri, {
    mimeType,
    dialogTitle: '导出账目',
  });
}

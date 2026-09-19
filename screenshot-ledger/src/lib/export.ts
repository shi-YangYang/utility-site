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
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: '导出账目' });
}

export async function shareTextFile(
  text: string,
  fileName: string,
  mimeType: string,
): Promise<void> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: '导出账目' });
}

export async function shareImageFile(sourceUri: string, fileName: string): Promise<void> {
  const destination = new File(Paths.cache, fileName);
  if (destination.exists) destination.delete();
  const source = new File(sourceUri);
  source.copySync(destination);
  await Sharing.shareAsync(destination.uri, { mimeType: 'image/png', dialogTitle: '导出账目' });
}

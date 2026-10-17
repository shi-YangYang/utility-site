import * as LegacyFS from 'expo-file-system/legacy';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';

export const ALBUM_NAME = '截图记账';

export async function canShare(): Promise<boolean> {
  return Sharing.isAvailableAsync();
}

export function writeBase64File(base64: string, fileName: string): string {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(base64, { encoding: 'base64' });
  return file.uri;
}

export function writeTextFile(text: string, fileName: string): string {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(text);
  return file.uri;
}

export function copyImageFile(sourceUri: string, fileName: string): string {
  const destination = new File(Paths.cache, fileName);
  if (destination.exists) destination.delete();
  new File(sourceUri).copySync(destination);
  return destination.uri;
}

export async function shareFile(fileUri: string, mimeType: string): Promise<void> {
  await Sharing.shareAsync(fileUri, { mimeType, dialogTitle: '导出账目' });
}

export function removeFile(fileUri: string): void {
  const file = new File(fileUri);
  if (file.exists) file.delete();
}

export async function requestMediaPermission(): Promise<boolean> {
  const { granted } = await MediaLibrary.requestPermissionsAsync();
  return granted;
}

export async function saveImageToLibrary(fileUri: string): Promise<void> {
  const asset = await MediaLibrary.createAssetAsync(fileUri);
  const album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
  if (album == null) {
    await MediaLibrary.createAlbumAsync(ALBUM_NAME, asset, false);
  } else {
    await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
  }
}

export async function requestDocumentFolder(): Promise<string | null> {
  const result = await LegacyFS.StorageAccessFramework.requestDirectoryPermissionsAsync();
  return result.granted ? result.directoryUri : null;
}

export async function saveDocumentToFolder(
  folderUri: string,
  fileName: string,
  mimeType: string,
  content: string,
  base64: boolean,
): Promise<void> {
  const fileUri = await LegacyFS.StorageAccessFramework.createFileAsync(
    folderUri,
    fileName,
    mimeType,
  );
  await LegacyFS.writeAsStringAsync(fileUri, content, {
    encoding: base64 ? 'base64' : 'utf8',
  });
}

export function readDocumentBase64(fileUri: string): Promise<string> {
  return LegacyFS.readAsStringAsync(fileUri, { encoding: 'base64' });
}

export function readDocumentText(fileUri: string): Promise<string> {
  return LegacyFS.readAsStringAsync(fileUri);
}

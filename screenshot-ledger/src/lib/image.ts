import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const MAX_EDGE = 1440;
const JPEG_QUALITY = 0.72;
const IMAGES_DIR = 'images';

export interface PreparedImage {
  uri: string;
  base64: string;
  hash: string;
  width: number;
  height: number;
}

export async function pickImages(selectionLimit = 10): Promise<ImagePicker.ImagePickerAsset[]> {
  await ImagePicker.requestMediaLibraryPermissionsAsync();
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit,
    quality: 1,
  });
  return result.canceled ? [] : result.assets;
}

export async function prepareImage(
  asset: ImagePicker.ImagePickerAsset,
): Promise<PreparedImage> {
  const sourceWidth = asset.width ?? 0;
  const sourceHeight = asset.height ?? 0;
  const longEdge = Math.max(sourceWidth, sourceHeight);

  const context = ImageManipulator.manipulate(asset.uri);
  if (longEdge > MAX_EDGE) {
    const scale = MAX_EDGE / longEdge;
    context.resize({
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    });
  }
  const rendered = await context.renderAsync();
  const output = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: JPEG_QUALITY,
    base64: true,
  });
  if (!output.base64) throw new Error('图片处理失败：没有拿到 base64');

  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    output.base64,
  );
  return {
    uri: output.uri,
    base64: output.base64,
    hash,
    width: output.width,
    height: output.height,
  };
}

export async function persistImage(prepared: PreparedImage): Promise<string> {
  const directory = new Directory(Paths.document, IMAGES_DIR);
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `${prepared.hash}.jpg`);
  if (!destination.exists) {
    const source = new File(prepared.uri);
    await source.copy(destination);
  }
  return destination.uri;
}

export function deleteImageFile(imagePath: string | null): void {
  if (!imagePath) return;
  try {
    const file = new File(imagePath);
    if (file.exists) file.delete();
  } catch {
    // 文件不存在或已被清理，忽略
  }
}

import { AppError } from '@/lib/utils/app-error';
import { isPhotoType, photoExtension, type PhotoType } from '@/lib/utils/photo-type';

function encode(canvas: HTMLCanvasElement, type: PhotoType) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
}

export async function resizePhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new AppError('imageOnly');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new AppError('photoPrepare');
  });
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new AppError('photoUnsupported');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // Safari cannot encode WebP from a canvas and silently returns PNG instead.
  let blob = await encode(canvas, 'image/webp');
  if (blob && blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg');
  if (!blob) throw new AppError('photoPrepare');
  if (!isPhotoType(blob.type)) throw new AppError('photoUnsupported');
  if (blob.size > 2_000_000) throw new AppError('photoTooLarge');
  const name = `${file.name.replace(/\.[^.]+$/, '')}.${photoExtension(blob.type)}`;
  return new File([blob], name, { type: blob.type });
}

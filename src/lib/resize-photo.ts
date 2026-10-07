import { AppError } from '@/lib/app-error';

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
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.82),
  );
  if (!blob) throw new AppError('photoPrepare');
  if (blob.size > 2_000_000) throw new AppError('photoTooLarge');
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
}

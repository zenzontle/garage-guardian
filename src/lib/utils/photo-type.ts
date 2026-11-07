import { AppError } from '@/lib/utils/app-error';

// MIME types the visit-photos bucket accepts, mapped to storage extensions.
const PHOTO_EXTENSIONS = { 'image/webp': 'webp', 'image/jpeg': 'jpg' } as const;

export type PhotoType = keyof typeof PHOTO_EXTENSIONS;

export function isPhotoType(type: string): type is PhotoType {
  return Object.hasOwn(PHOTO_EXTENSIONS, type);
}

export function photoExtension(type: string): string {
  if (!isPhotoType(type)) throw new AppError('photoUnsupported');
  return PHOTO_EXTENSIONS[type];
}

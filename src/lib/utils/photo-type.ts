// MIME types the visit-photos bucket accepts (migration 0013), mapped to storage extensions.
const PHOTO_EXTENSIONS = { 'image/webp': 'webp', 'image/jpeg': 'jpg' } as const;

export type PhotoType = keyof typeof PHOTO_EXTENSIONS;

export function isPhotoType(type: string): type is PhotoType {
  return Object.hasOwn(PHOTO_EXTENSIONS, type);
}

// Photos saved before JPEG support were all labeled WebP, so unknown types keep that extension.
export function photoExtension(type: string): string {
  return isPhotoType(type) ? PHOTO_EXTENSIONS[type] : 'webp';
}

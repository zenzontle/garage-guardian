import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppError } from './app-error';
import { resizePhoto } from './resize-photo';

const photo = new File(['original'], 'IMG_0001.HEIC.jpeg', { type: 'image/jpeg' });
let encoded: Record<string, Blob | null>;

beforeEach(() => {
  encoded = {
    'image/webp': new Blob(['webp'], { type: 'image/webp' }),
    'image/jpeg': new Blob(['jpeg'], { type: 'image/jpeg' }),
  };
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 4032, height: 3024, close: vi.fn() })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) =>
    callback(encoded[type!] ?? null),
  );
});
afterEach(() => vi.unstubAllGlobals());

it('encodes WebP at no more than 1800 pixels on the long edge', async () => {
  const resized = await resizePhoto(photo);
  expect(resized).toMatchObject({ name: 'IMG_0001.HEIC.webp', type: 'image/webp' });
  expect(await resized.text()).toBe('webp');
  const canvas = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock
    .contexts[0] as HTMLCanvasElement;
  expect([canvas.width, canvas.height]).toEqual([1800, 1350]);
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledOnce();
});

it('falls back to JPEG with a matching type and extension when WebP comes back as PNG', async () => {
  // Safari ignores the WebP request and returns PNG, which is often over the size limit.
  encoded['image/webp'] = new Blob([new Uint8Array(2_500_000)], { type: 'image/png' });
  const resized = await resizePhoto(photo);
  expect(resized).toMatchObject({ name: 'IMG_0001.HEIC.jpg', type: 'image/jpeg' });
  expect(await resized.text()).toBe('jpeg');
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenLastCalledWith(
    expect.any(Function),
    'image/jpeg',
    0.82,
  );
});

it('rejects a fallback that is still too large', async () => {
  encoded['image/webp'] = new Blob(['png'], { type: 'image/png' });
  encoded['image/jpeg'] = new Blob([new Uint8Array(2_000_001)], { type: 'image/jpeg' });
  await expect(resizePhoto(photo)).rejects.toMatchObject({ code: 'photoTooLarge' });
});

it('never labels bytes with a type the browser did not produce', async () => {
  encoded['image/webp'] = new Blob(['png'], { type: 'image/png' });
  encoded['image/jpeg'] = new Blob(['png'], { type: 'image/png' });
  const failure = await resizePhoto(photo).catch((cause: unknown) => cause);
  expect(failure).toBeInstanceOf(AppError);
  expect(failure).toMatchObject({ code: 'photoUnsupported' });
});

it('reports a failed encode', async () => {
  encoded['image/webp'] = null;
  await expect(resizePhoto(photo)).rejects.toMatchObject({ code: 'photoPrepare' });
});

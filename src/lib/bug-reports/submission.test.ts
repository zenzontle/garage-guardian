// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { REPORT_LIMITS } from './shared';
import { GitHubFailure } from './github';
import { readReport, reconcileReceipt, submitReport } from './submission';
import { memoryStore, metadata, report } from './fixtures.test-helper';

function request(value: unknown = report(), files: File[] = []) {
  const form = new FormData(); form.append('report', JSON.stringify(value)); files.forEach((file) => form.append('screenshots', file));
  return new Request('http://localhost/api/bug-reports', { method: 'POST', body: form });
}
function adapter() { return { upload: vi.fn(async (_bytes: Uint8Array, index: number) => `https://github.com/user-attachments/assets/${index}`), create: vi.fn(async () => 'https://github.com/zenzontle/garage-guardian/issues/1'), reconcile: vi.fn(async (): Promise<string | null> => null) }; }

describe('submission validation', () => {
  it('validates strict metadata, lengths, acknowledgment and diagnostics', async () => {
    for (const value of [{ ...report(), title: 'tiny' }, { ...report(), description: 'x'.repeat(5001) }, { ...report(), acknowledged: false }, { ...report(), extra: true }, { ...report(), metadata: { ...metadata, reporterId: `reporter-${'b'.repeat(24)}` } }, { ...report(), context: { ...report().context, viewport: { width: NaN, height: 10, pixelRatio: 1 } } }, { ...report(), diagnostics: [{ source: 'operation', message: 'token=secret', stack: '', timestamp: Date.now() }] }]) {
      await expect(readReport(request(value), metadata)).rejects.toHaveProperty('status');
    }
    await expect(readReport(request(), metadata)).resolves.toHaveProperty('report.title', 'Broken car dialog');
    await expect(readReport(request({ ...report(), title: 'x'.repeat(120), description: 'x'.repeat(5000) }), metadata)).resolves.toBeDefined();
  });
  it('caps streamed bodies without relying on Content-Length', async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(REPORT_LIMITS.body + 1)); }, cancel() { cancelled = true; } });
    const input = new Request('http://localhost', { method: 'POST', body: stream, headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, duplex: 'half' } as RequestInit);
    await expect(readReport(input, metadata)).rejects.toHaveProperty('status', 413); expect(cancelled).toBe(true);
  });
  it('rejects duplicate and unknown multipart fields', async () => {
    for (const field of ['report', 'other']) {
      const form = new FormData(); form.append('report', JSON.stringify(report())); form.append(field, '{}');
      await expect(readReport(new Request('http://localhost', { method: 'POST', body: form }), metadata)).rejects.toHaveProperty('status', 422);
    }
  });
  it('checks actual image contents and strips metadata by re-encoding', async () => {
    const png = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#00ff00' } }).withMetadata({ density: 300 }).png().toBuffer();
    const good = new File([png], 'private-plate-name.png', { type: 'image/png' });
    const input = await readReport(request(report(), [good]), metadata);
    const info = await sharp(input.images[0]).metadata();
    expect(info.format).toBe('webp'); expect(info.exif).toBeUndefined(); expect(info.icc).toBeUndefined();
    expect(input.report).not.toHaveProperty('filenames');
    for (const file of [new File([png], 'fake.jpg', { type: 'image/jpeg' }), new File(['broken'], 'broken.png', { type: 'image/png' }), new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }), new File([new Uint8Array(REPORT_LIMITS.file + 1)], 'large.png', { type: 'image/png' })]) {
      await expect(readReport(request(report(), [file]), metadata)).rejects.toHaveProperty('status', 422);
    }
    await expect(readReport(request(report(), [good, good, good]), metadata)).rejects.toHaveProperty('status', 422);
  });
  it('rejects images above the decoded pixel cap even when compressed bytes fit', async () => {
    const png = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: '#ffffff' } }).png().toBuffer();
    expect(png.length).toBeLessThan(REPORT_LIMITS.file);
    await expect(readReport(request(report(), [new File([png], 'too-many-pixels.png', { type: 'image/png' })]), metadata)).rejects.toHaveProperty('status', 422);
  });
});

describe('GitHub delivery and retries', () => {
  const input = () => ({ report: report(), images: [new Uint8Array([1]), new Uint8Array([2])], hash: 'test-hash' });
  it('publishes once under concurrent duplicate submissions and replays success', async () => {
    const store = memoryStore(), github = adapter(), value = input();
    const results = await Promise.allSettled([submitReport(store, github, 'user', 'ip', value), submitReport(store, github, 'user', 'ip', value)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(github.create).toHaveBeenCalledTimes(1);
    expect(github.create.mock.calls[0]).toBeDefined();
    const replay = await submitReport(store, github, 'user', 'ip', value);
    expect(replay.status).toBe(201); expect(github.create).toHaveBeenCalledTimes(1);
    await expect(submitReport(store, github, 'user', 'ip', { ...value, hash: 'changed' })).rejects.toHaveProperty('code', 'DRAFT_CHANGED');
    expect(await store.get('different-user', value.report.submissionId)).toBeNull();
  });
  it('reuses successful attachments after a partial upload failure', async () => {
    const store = memoryStore(), github = adapter(), value = input();
    github.upload.mockResolvedValueOnce('https://github.com/user-attachments/assets/first').mockRejectedValueOnce(new GitHubFailure(false));
    await expect(submitReport(store, github, 'user', 'ip', value)).rejects.toHaveProperty('code', 'GITHUB_FAILED');
    expect(github.create).not.toHaveBeenCalled();
    await submitReport(store, github, 'user', 'ip', value);
    expect(github.upload).toHaveBeenCalledTimes(3); expect(github.create).toHaveBeenCalledTimes(1);
  });
  it('reconciles ambiguous creation instead of creating another issue', async () => {
    const store = memoryStore(), github = adapter(), value = input();
    github.create.mockRejectedValueOnce(new GitHubFailure(true));
    expect((await submitReport(store, github, 'user', 'ip', value)).status).toBe(202);
    expect((await submitReport(store, github, 'user', 'ip', value)).status).toBe(202);
    github.reconcile.mockResolvedValueOnce('https://github.com/zenzontle/garage-guardian/issues/1');
    expect((await submitReport(store, github, 'user', 'ip', value)).status).toBe(201);
    expect(github.create).toHaveBeenCalledTimes(1);
  });
  it.each(['creating', 'unknown'] as const)('re-reads an uploading receipt under the lease before recovering a now-%s submission', async (state) => {
    const store = memoryStore(), github = adapter(), value = input();
    const stale = { hash: value.hash, state: 'uploading' as const, assets: [], createdAt: Date.now() };
    await store.claim('user', value.report.submissionId, { ...stale, state });
    const result = await reconcileReceipt(store, github, 'user', value.report.submissionId, stale, metadata.reporterId);
    expect(result.state).toBe('unknown');
    expect((await store.get('user', value.report.submissionId))?.state).toBe('unknown');
    expect(github.reconcile).toHaveBeenCalledExactlyOnceWith(value.report.submissionId, metadata.reporterId);
    expect(github.upload).not.toHaveBeenCalled(); expect(github.create).not.toHaveBeenCalled();
  });
  it('does not make an uploading receipt retryable when the lease check fails', async () => {
    const store = memoryStore(), github = adapter(), value = input();
    const receipt = { hash: value.hash, state: 'uploading' as const, assets: [], createdAt: Date.now() };
    await store.claim('user', value.report.submissionId, receipt);
    store.lock = vi.fn().mockRejectedValue(new Error('Redis unavailable'));
    await expect(reconcileReceipt(store, github, 'user', value.report.submissionId, receipt, metadata.reporterId)).rejects.toThrow('Redis unavailable');
    expect(await store.get('user', value.report.submissionId)).toEqual(receipt);
    expect(github.upload).not.toHaveBeenCalled(); expect(github.create).not.toHaveBeenCalled();
  });
  it('blocks GitHub writes when rate limiting fails', async () => {
    const store = memoryStore(), github = adapter();
    store.limit = vi.fn().mockRejectedValue(new Error('Redis unavailable'));
    await expect(submitReport(store, github, 'user', 'ip', input())).rejects.toThrow();
    expect(github.upload).not.toHaveBeenCalled(); expect(github.create).not.toHaveBeenCalled();
  });
});

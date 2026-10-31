// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { REPORT_LIMITS, cleanDiagnostic } from './shared';
import { DeliveryFailure } from './linear';
import {
  decodeReport,
  readReport as parseReport,
  reconcileReceipt,
  replayReport,
  submitReport,
} from './submission';
import { memoryStore, metadata, oversizedReport, report } from './fixtures.test-helper';

async function readReport(request: Request, metadata: Parameters<typeof parseReport>[1]) {
  return decodeReport(await parseReport(request, metadata));
}

function request(value: unknown = report(), files: File[] = []) {
  const form = new FormData();
  form.append('report', JSON.stringify(value));
  files.forEach((file) => form.append('screenshots', file));
  return new Request('http://localhost/api/feedback', { method: 'POST', body: form });
}
function adapter() {
  return {
    issueId: vi.fn((userId: string, submissionId: string) => `issue:${userId}:${submissionId}`),
    upload: vi.fn(
      async (_bytes: Uint8Array, index: number) => `https://uploads.linear.app/org/${index}`,
    ),
    create: vi.fn<(title: string, body: string, issueId: string) => Promise<string>>(
      async () => 'FB-1',
    ),
    reconcile: vi.fn(async (): Promise<string | null> => null),
  };
}

describe('submission validation', () => {
  it.each([
    'password="correct horse battery staple"',
    'Authorization: Basic dXNlcjpwYXNz',
    'Cookie: session=abc; connect.sid=private',
    'Cookie: [REDACTED]; connect.sid=private',
    'remote/203.0.113.5 client/192.168.1.20',
    'client=2001:db8::1234',
    'https://[2001:db8::1]/request',
    '::ffff:192.0.2.1',
    'fe80::abcd%eth0',
  ])(
    'rejects raw sensitive diagnostics and accepts their complete redaction: %s',
    async (message) => {
      const entry = {
        source: 'operation' as const,
        timestamp: Date.now(),
        message,
        stack: message,
      };
      await expect(
        readReport(request({ ...report(), diagnostics: [entry] }), metadata),
      ).rejects.toHaveProperty('code', 'UNSAFE_DIAGNOSTICS');
      const sanitized = cleanDiagnostic(entry);
      const input = await readReport(request({ ...report(), diagnostics: [sanitized] }), metadata);
      expect(input.report.diagnostics).toEqual([sanitized]);
    },
  );
  it('rejects an oversized formatted body before image decoding', async () => {
    const corrupt = new File(['broken'], 'x.png', { type: 'image/png' });
    await expect(
      readReport(request(oversizedReport(), [corrupt]), metadata),
    ).rejects.toHaveProperty('code', 'ISSUE_TOO_LARGE');
  });
  it('validates strict metadata, lengths, acknowledgment and diagnostics', async () => {
    for (const value of [
      { ...report(), description: 'too short' },
      { ...report(), title: 'Unexpected title' },
      { ...report(), description: 'x'.repeat(5001) },
      { ...report(), acknowledged: false },
      { ...report(), extra: true },
      { ...report(), metadata: { ...metadata, reporterId: `reporter-${'b'.repeat(24)}` } },
      {
        ...report(),
        context: { ...report().context, viewport: { width: NaN, height: 10, pixelRatio: 1 } },
      },
      {
        ...report(),
        diagnostics: [
          { source: 'operation', message: 'token=secret', stack: '', timestamp: Date.now() },
        ],
      },
    ]) {
      await expect(readReport(request(value), metadata)).rejects.toHaveProperty('status');
    }
    await expect(readReport(request(), metadata)).resolves.toHaveProperty(
      'report.description',
      report().description,
    );
    await expect(
      readReport(request({ ...report(), description: 'x'.repeat(5000) }), metadata),
    ).resolves.toBeDefined();
  });
  it('caps streamed bodies without relying on Content-Length', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(REPORT_LIMITS.body + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const input = new Request('http://localhost', {
      method: 'POST',
      body: stream,
      headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
      duplex: 'half',
    } as RequestInit);
    await expect(readReport(input, metadata)).rejects.toHaveProperty('status', 413);
    expect(cancelled).toBe(true);
  });
  it('rejects duplicate and unknown multipart fields', async () => {
    for (const field of ['report', 'other']) {
      const form = new FormData();
      form.append('report', JSON.stringify(report()));
      form.append(field, '{}');
      await expect(
        readReport(new Request('http://localhost', { method: 'POST', body: form }), metadata),
      ).rejects.toHaveProperty('status', 422);
    }
  });
  it('checks actual image contents and strips metadata by re-encoding', async () => {
    const png = await sharp({
      create: { width: 20, height: 10, channels: 3, background: '#00ff00' },
    })
      .withMetadata({ density: 300 })
      .png()
      .toBuffer();
    const good = new File([png], 'private-plate-name.png', { type: 'image/png' });
    const input = await readReport(request(report(), [good]), metadata);
    const info = await sharp(input.images[0]).metadata();
    expect(info.format).toBe('webp');
    expect(info.exif).toBeUndefined();
    expect(info.icc).toBeUndefined();
    expect(input.report).not.toHaveProperty('filenames');
    for (const file of [
      new File([png], 'fake.jpg', { type: 'image/jpeg' }),
      new File(['broken'], 'broken.png', { type: 'image/png' }),
      new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }),
      new File([new Uint8Array(REPORT_LIMITS.file + 1)], 'large.png', { type: 'image/png' }),
    ]) {
      await expect(readReport(request(report(), [file]), metadata)).rejects.toHaveProperty(
        'status',
        422,
      );
    }
    await expect(
      readReport(request(report(), [good, good, good]), metadata),
    ).rejects.toHaveProperty('status', 422);
  });
  it('rejects images above the decoded pixel cap even when compressed bytes fit', async () => {
    const png = await sharp({
      create: { width: 5000, height: 4001, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    expect(png.length).toBeLessThan(REPORT_LIMITS.file);
    await expect(
      readReport(
        request(report(), [new File([png], 'too-many-pixels.png', { type: 'image/png' })]),
        metadata,
      ),
    ).rejects.toHaveProperty('status', 422);
  });
});

describe('Linear delivery and retries', () => {
  const input = () => ({
    report: report(),
    images: [new Uint8Array([1]), new Uint8Array([2])],
    hash: 'test-hash',
  });
  it('publishes once under concurrent duplicate submissions and replays success', async () => {
    const store = memoryStore(),
      linear = adapter(),
      value = input();
    const results = await Promise.allSettled([
      submitReport(store, linear, 'user', 'ip', value),
      submitReport(store, linear, 'user', 'ip', value),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(linear.create).toHaveBeenCalledTimes(1);
    expect(linear.create.mock.calls[0][1]).toContain(
      '![Screenshot 1](https://uploads.linear.app/org/0)',
    );
    expect(linear.create.mock.calls[0][2]).toBe(`issue:user:${value.report.submissionId}`);
    const replay = await submitReport(store, linear, 'user', 'ip', value);
    expect(replay.status).toBe(201);
    expect(linear.create).toHaveBeenCalledTimes(1);
    await expect(
      submitReport(store, linear, 'user', 'ip', { ...value, hash: 'changed' }),
    ).rejects.toHaveProperty('code', 'DRAFT_CHANGED');
    expect(await store.get('different-user', value.report.submissionId)).toBeNull();
  });
  it('reuses successful attachments after a partial upload failure', async () => {
    const store = memoryStore(),
      linear = adapter(),
      value = input();
    linear.upload
      .mockResolvedValueOnce('https://uploads.linear.app/org/first')
      .mockRejectedValueOnce(new DeliveryFailure(false));
    await expect(submitReport(store, linear, 'user', 'ip', value)).rejects.toHaveProperty(
      'code',
      'DELIVERY_FAILED',
    );
    expect(linear.create).not.toHaveBeenCalled();
    await submitReport(store, linear, 'user', 'ip', value);
    expect(linear.upload).toHaveBeenCalledTimes(3);
    expect(linear.create).toHaveBeenCalledTimes(1);
  });
  it('reconciles ambiguous creation instead of creating another issue', async () => {
    const store = memoryStore(),
      linear = adapter(),
      value = input();
    linear.create.mockRejectedValueOnce(new DeliveryFailure(true));
    expect((await submitReport(store, linear, 'user', 'ip', value)).status).toBe(202);
    expect((await submitReport(store, linear, 'user', 'ip', value)).status).toBe(202);
    linear.reconcile.mockResolvedValueOnce('FB-1');
    expect((await submitReport(store, linear, 'user', 'ip', value)).status).toBe(201);
    expect(linear.create).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['creating', 'status'],
    ['unknown', 'status'],
    ['creating', 'replay'],
    ['unknown', 'replay'],
  ] as const)(
    'preserves reconciliation success against a concurrent stale %s %s check',
    async (state, contender) => {
      const store = memoryStore(),
        linear = adapter(),
        value = input();
      const receipt = { hash: value.hash, state, assets: [], createdAt: Date.now() };
      await store.claim('user', value.report.submissionId, receipt);
      let resolveFound!: (reference: string) => void,
        resolveMissing!: (reference: null) => void,
        started!: () => void;
      const found = new Promise<string>((resolve) => {
        resolveFound = resolve;
      });
      const missing = new Promise<null>((resolve) => {
        resolveMissing = resolve;
      });
      const checking = new Promise<void>((resolve) => {
        started = resolve;
      });
      linear.reconcile
        .mockImplementationOnce(() => {
          started();
          return found;
        })
        .mockImplementationOnce(() => missing);
      const first = reconcileReceipt(store, linear, 'user', value.report.submissionId, receipt);
      await checking;
      const second =
        contender === 'status'
          ? reconcileReceipt(store, linear, 'user', value.report.submissionId, receipt)
          : replayReport(store, linear, 'user', value.report, value.hash);
      // Let the concurrent check start before Linear confirms the first result.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const issueReference = 'FB-1';
      resolveFound(issueReference);
      expect(await first).toMatchObject({ state: 'succeeded', issueReference });
      resolveMissing(null);
      await second;
      expect(await store.get('user', value.report.submissionId)).toMatchObject({
        state: 'succeeded',
        issueReference,
      });
      expect(
        await reconcileReceipt(store, linear, 'user', value.report.submissionId, receipt),
      ).toMatchObject({ state: 'succeeded', issueReference });
      expect(linear.reconcile).toHaveBeenCalledTimes(1);
      expect(linear.create).not.toHaveBeenCalled();
    },
  );
  it('keeps status reconciliation out of an active issue creation lease', async () => {
    const store = memoryStore(),
      linear = adapter(),
      value = input();
    let finish!: (reference: string) => void, started!: () => void;
    const creating = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    linear.create.mockImplementationOnce(() => {
      started();
      return creating;
    });
    const submission = submitReport(store, linear, 'user', 'ip', value);
    await pending;
    const receipt = (await store.get('user', value.report.submissionId))!;
    expect(
      await reconcileReceipt(store, linear, 'user', value.report.submissionId, receipt),
    ).toEqual(receipt);
    expect(linear.reconcile).not.toHaveBeenCalled();
    finish('FB-1');
    expect((await submission).status).toBe(201);
  });
  it('allows reconciliation to retry after a Linear lookup failure', async () => {
    const store = memoryStore(),
      linear = adapter(),
      value = input();
    const receipt = {
      hash: value.hash,
      state: 'unknown' as const,
      assets: [],
      createdAt: Date.now(),
    };
    await store.claim('user', value.report.submissionId, receipt);
    linear.reconcile.mockRejectedValueOnce(new DeliveryFailure(true)).mockResolvedValueOnce('FB-1');
    await expect(
      reconcileReceipt(store, linear, 'user', value.report.submissionId, receipt),
    ).rejects.toBeInstanceOf(DeliveryFailure);
    expect(await store.get('user', value.report.submissionId)).toEqual(receipt);
    expect(
      await reconcileReceipt(store, linear, 'user', value.report.submissionId, receipt),
    ).toMatchObject({ state: 'succeeded' });
    expect(linear.reconcile).toHaveBeenCalledTimes(2);
  });
  it('returns an uncertain receipt discovered after replay without re-entering its submission lease', async () => {
    const store = memoryStore(),
      linear = adapter(),
      value = input();
    const receipt = {
      hash: value.hash,
      state: 'unknown' as const,
      assets: [],
      createdAt: Date.now(),
    };
    await store.claim('user', value.report.submissionId, receipt);
    store.get = vi.fn(store.get).mockResolvedValueOnce(null);
    const response = await submitReport(store, linear, 'user', 'ip', value);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ state: 'unknown' });
    expect(linear.reconcile).not.toHaveBeenCalled();
    expect(linear.create).not.toHaveBeenCalled();
    linear.reconcile.mockResolvedValueOnce('FB-1');
    expect(
      await reconcileReceipt(store, linear, 'user', value.report.submissionId, receipt),
    ).toMatchObject({ state: 'succeeded' });
  });
  it.each(['creating', 'unknown'] as const)(
    're-reads an uploading receipt under the lease before recovering a now-%s submission',
    async (state) => {
      const store = memoryStore(),
        linear = adapter(),
        value = input();
      const stale = {
        hash: value.hash,
        state: 'uploading' as const,
        assets: [],
        createdAt: Date.now(),
      };
      await store.claim('user', value.report.submissionId, { ...stale, state });
      const result = await reconcileReceipt(
        store,
        linear,
        'user',
        value.report.submissionId,
        stale,
      );
      expect(result.state).toBe('unknown');
      expect((await store.get('user', value.report.submissionId))?.state).toBe('unknown');
      expect(linear.reconcile).toHaveBeenCalledExactlyOnceWith(
        `issue:user:${value.report.submissionId}`,
      );
      expect(linear.upload).not.toHaveBeenCalled();
      expect(linear.create).not.toHaveBeenCalled();
    },
  );
  it('does not make an uploading receipt retryable when the lease check fails', async () => {
    const store = memoryStore(),
      linear = adapter(),
      value = input();
    const receipt = {
      hash: value.hash,
      state: 'uploading' as const,
      assets: [],
      createdAt: Date.now(),
    };
    await store.claim('user', value.report.submissionId, receipt);
    store.lock = vi.fn().mockRejectedValue(new Error('Redis unavailable'));
    await expect(
      reconcileReceipt(store, linear, 'user', value.report.submissionId, receipt),
    ).rejects.toThrow('Redis unavailable');
    expect(await store.get('user', value.report.submissionId)).toEqual(receipt);
    expect(linear.upload).not.toHaveBeenCalled();
    expect(linear.create).not.toHaveBeenCalled();
  });
  it('blocks Linear writes when rate limiting fails', async () => {
    const store = memoryStore(),
      linear = adapter();
    store.limit = vi.fn().mockRejectedValue(new Error('Redis unavailable'));
    await expect(submitReport(store, linear, 'user', 'ip', input())).rejects.toThrow();
    expect(linear.upload).not.toHaveBeenCalled();
    expect(linear.create).not.toHaveBeenCalled();
  });
});

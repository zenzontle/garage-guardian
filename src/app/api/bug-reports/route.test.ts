// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { POST } from './route';
import { GET as configuration } from './config/route';
import { GET as status } from './[submissionId]/route';
import { memoryStore, oversizedReport, report } from '@/lib/bug-reports/fixtures.test-helper';
import type { ReportStore } from '@/lib/bug-reports/store';
import { ReportError } from '@/lib/bug-reports/server-config';

const runtime = vi.hoisted(() => ({
  store: null as unknown as ReportStore,
  getUser: vi.fn(),
  create: vi.fn(),
  upload: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: runtime.getUser } }),
}));
vi.mock('@/lib/bug-reports/store', () => ({ reportStore: () => runtime.store }));
vi.mock('@/lib/bug-reports/github', async (original) => ({
  ...(await original<typeof import('@/lib/bug-reports/github')>()),
  githubAdapter: () => ({
    create: runtime.create,
    upload: runtime.upload,
    reconcile: runtime.reconcile,
  }),
}));
vi.mock('sharp', async (original) => {
  const sharpModule = await original<typeof import('sharp')>();
  return { ...sharpModule, default: vi.fn(sharpModule.default) };
});
const headers = {
  authorization: 'Bearer verified-token',
  'user-agent': 'Test browser / OS',
  'x-vercel-forwarded-for': '192.0.2.1',
};

beforeEach(() => {
  for (const [key, value] of Object.entries({
    BUG_REPORTS_ENABLED: 'true',
    BUG_REPORT_HMAC_SECRET: 'x'.repeat(32),
    BUG_REPORT_GITHUB_TOKEN: 'github-test',
    BUG_REPORT_ENVIRONMENT: 'preview',
    BUG_REPORT_RELEASE: '0.1.0+test',
    UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'redis-test',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
    VERCEL: '1',
  }))
    vi.stubEnv(key, value);
  runtime.store = memoryStore();
  runtime.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: 'verified-account' } }, error: null });
  runtime.create
    .mockReset()
    .mockResolvedValue('https://github.com/zenzontle/garage-guardian/issues/7');
  runtime.upload.mockReset().mockResolvedValue('https://github.com/user-attachments/assets/test');
  runtime.reconcile.mockReset().mockResolvedValue(null);
  vi.mocked(sharp).mockClear();
});
async function postRequest(extra: Record<string, unknown> = {}, files: File[] = []) {
  const configResponse = await configuration(
    new Request('https://app.test/api/bug-reports/config', { headers }),
  );
  const config = await configResponse.json();
  const form = new FormData();
  form.append('report', JSON.stringify({ ...report(), metadata: config.metadata, ...extra }));
  files.forEach((file) => form.append('screenshots', file));
  return new Request('https://app.test/api/bug-reports', { method: 'POST', headers, body: form });
}
async function screenshot() {
  const bytes = await sharp({
    create: { width: 20, height: 10, channels: 3, background: '#00ff00' },
  })
    .png()
    .toBuffer();
  return new File([bytes], 'synthetic.png', { type: 'image/png' });
}
describe('HTTP reporting boundary', () => {
  it.each(['lookup', 'submission-lookup', 'lock', 'locked-lookup'] as const)(
    'allows the same report to retry after a pre-write Redis %s failure',
    async (stage) => {
      const request = await postRequest(),
        retry = request.clone();
      const get = runtime.store.get;
      if (stage === 'lock')
        runtime.store.lock = vi
          .fn(runtime.store.lock)
          .mockRejectedValueOnce(new Error('private Redis details'));
      else {
        const lookup = vi.fn(get);
        for (
          let index = 0;
          index < (stage === 'lookup' ? 0 : stage === 'submission-lookup' ? 1 : 2);
          index++
        )
          lookup.mockImplementationOnce(get);
        lookup.mockRejectedValueOnce(new Error('private Redis details'));
        runtime.store.get = lookup;
      }
      const response = await POST(request);
      expect(response.status).toBe(503);
      const result = await response.json();
      expect(result.code).toBe('SUBMISSION_NOT_STARTED');
      expect(JSON.stringify(result)).not.toContain('private Redis details');
      expect(await get('verified-account', report().submissionId)).toBeNull();
      expect(runtime.upload).not.toHaveBeenCalled();
      expect(runtime.create).not.toHaveBeenCalled();
      expect((await POST(retry)).status).toBe(201);
      expect(runtime.create).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps Redis receipt-write failures ambiguous', async () => {
    runtime.store.save = vi.fn().mockRejectedValue(new Error('Redis unavailable'));
    const response = await POST(await postRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('UNAVAILABLE');
    expect(await runtime.store.get('verified-account', report().submissionId)).toMatchObject({
      state: 'uploading',
    });
    expect(runtime.upload).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it('keeps a Redis reconciliation lock failure ambiguous for an existing receipt', async () => {
    expect((await POST(await postRequest())).status).toBe(201);
    const receipt = (await runtime.store.get('verified-account', report().submissionId))!;
    await runtime.store.save('verified-account', report().submissionId, {
      ...receipt,
      state: 'unknown',
      issueUrl: undefined,
    });
    runtime.store.lock = vi.fn().mockRejectedValue(new Error('Redis unavailable'));
    const response = await POST(await postRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('UNAVAILABLE');
    expect(runtime.create).toHaveBeenCalledTimes(1);
  });
  it('rejects an oversized public body before processing, decoding or GitHub writes', async () => {
    const draft = oversizedReport(),
      file = await screenshot();
    const request = await postRequest(
      { description: draft.description, diagnostics: draft.diagnostics },
      [file],
    );
    runtime.store.processing = vi.fn();
    vi.mocked(sharp).mockClear();
    const response = await POST(request);
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe('ISSUE_TOO_LARGE');
    expect(runtime.store.processing).not.toHaveBeenCalled();
    expect(sharp).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.upload).not.toHaveBeenCalled();
  });
  it.each([429, 503])('stops image decoding when processing limits return %s', async (code) => {
    const file = await screenshot(),
      request = await postRequest({}, [file]);
    runtime.store.processing = vi
      .fn()
      .mockRejectedValue(
        new ReportError(
          code,
          code === 429 ? 'RATE_LIMITED' : 'LIMITER_UNAVAILABLE',
          'Unavailable',
          code === 429 ? 120 : undefined,
        ),
      );
    runtime.store.limit = vi.fn();
    vi.mocked(sharp).mockClear();
    const response = await POST(request);
    expect(response.status).toBe(code);
    if (code === 429) expect(response.headers.get('Retry-After')).toBe('120');
    expect(runtime.store.processing).toHaveBeenCalledExactlyOnceWith(
      'verified-account',
      '192.0.2.1',
    );
    expect(sharp).not.toHaveBeenCalled();
    expect(runtime.store.limit).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.upload).not.toHaveBeenCalled();
  });
  it.each(['succeeded', 'creating', 'unknown'] as const)(
    'replays matching %s receipts without decoding or consuming processing/submission limits',
    async (state) => {
      const file = await screenshot();
      expect((await POST(await postRequest({}, [file]))).status).toBe(201);
      const receipt = (await runtime.store.get('verified-account', report().submissionId))!;
      await runtime.store.save('verified-account', report().submissionId, {
        ...receipt,
        state,
        issueUrl: state === 'succeeded' ? receipt.issueUrl : undefined,
      });
      runtime.store.processing = vi
        .fn()
        .mockRejectedValue(new ReportError(429, 'RATE_LIMITED', 'Wait'));
      runtime.store.limit = vi.fn().mockRejectedValue(new ReportError(429, 'RATE_LIMITED', 'Wait'));
      vi.mocked(sharp).mockClear();
      expect((await POST(await postRequest({}, [file]))).status).toBe(
        state === 'succeeded' ? 201 : 202,
      );
      expect(sharp).not.toHaveBeenCalled();
      expect(runtime.store.processing).not.toHaveBeenCalled();
      expect(runtime.store.limit).not.toHaveBeenCalled();
      expect(runtime.create).toHaveBeenCalledTimes(1);
      expect(runtime.upload).toHaveBeenCalledTimes(1);
      expect(
        (await POST(await postRequest({ description: 'Changed report description' }, [file])))
          .status,
      ).toBe(409);
      expect(sharp).not.toHaveBeenCalled();
    },
  );
  it('does not expose reporting when disabled or create issues with missing configuration', async () => {
    vi.stubEnv('BUG_REPORTS_ENABLED', 'false');
    expect(await (await configuration(new Request('https://app.test'))).json()).toEqual({
      enabled: false,
    });
    expect((await POST(new Request('https://app.test', { method: 'POST' }))).status).toBe(404);
    vi.stubEnv('BUG_REPORTS_ENABLED', 'true');
    vi.stubEnv('BUG_REPORT_GITHUB_TOKEN', '');
    expect((await POST(new Request('https://app.test', { method: 'POST', headers }))).status).toBe(
      503,
    );
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it('rejects missing authentication and expired/spoofed tokens before parsing or publishing', async () => {
    expect((await POST(new Request('https://app.test', { method: 'POST' }))).status).toBe(401);
    runtime.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect((await POST(new Request('https://app.test', { method: 'POST', headers }))).status).toBe(
      401,
    );
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it('uses authoritative identity and validates before any provider writes', async () => {
    const response = await POST(await postRequest({ userId: 'spoofed' }));
    expect(response.status).toBe(422);
    expect(runtime.create).not.toHaveBeenCalled();
    const valid = await POST(await postRequest());
    expect(valid.status).toBe(201);
    expect((await valid.json()).issueUrl).toContain('/issues/7');
    expect(runtime.create.mock.calls[0][1]).not.toContain('verified-account');
  });
  it('keeps status reads scoped to the authenticated owner', async () => {
    await POST(await postRequest());
    const context = { params: Promise.resolve({ submissionId: report().submissionId }) };
    expect((await status(new Request('https://app.test', { headers }), context)).status).toBe(201);
    runtime.getUser.mockResolvedValue({ data: { user: { id: 'other-account' } }, error: null });
    expect((await status(new Request('https://app.test', { headers }), context)).status).toBe(404);
    expect(
      (
        await status(new Request('https://app.test', { headers }), {
          params: Promise.resolve({ submissionId: 'not-uuid' }),
        })
      ).status,
    ).toBe(422);
  });
  it('returns retry hints and prevents uploads when shared limits deny submission', async () => {
    const request = await postRequest();
    const { ReportError } = await import('@/lib/bug-reports/server-config');
    runtime.store.limit = vi
      .fn()
      .mockRejectedValue(new ReportError(429, 'RATE_LIMITED', 'Wait', 120));
    const response = await POST(request);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.upload).not.toHaveBeenCalled();
  });
});

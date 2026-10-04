// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { GET as configuration } from './config/route';
import { GET as status } from './[submissionId]/route';
import { memoryStore, report } from '@/lib/bug-reports/fixtures.test-helper';
import type { ReportStore } from '@/lib/bug-reports/store';

const runtime = vi.hoisted(() => ({ store: null as unknown as ReportStore, getUser: vi.fn(), create: vi.fn(), upload: vi.fn(), reconcile: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: runtime.getUser } }) }));
vi.mock('@/lib/bug-reports/store', () => ({ reportStore: () => runtime.store }));
vi.mock('@/lib/bug-reports/github', async (original) => ({ ...await original<typeof import('@/lib/bug-reports/github')>(), githubAdapter: () => ({ create: runtime.create, upload: runtime.upload, reconcile: runtime.reconcile }) }));
const headers = { authorization: 'Bearer verified-token', 'user-agent': 'Test browser / OS', 'x-vercel-forwarded-for': '192.0.2.1' };

beforeEach(() => {
  for (const [key, value] of Object.entries({ BUG_REPORTS_ENABLED: 'true', BUG_REPORT_HMAC_SECRET: 'x'.repeat(32), BUG_REPORT_GITHUB_TOKEN: 'github-test', BUG_REPORT_ENVIRONMENT: 'preview', BUG_REPORT_RELEASE: '0.1.0+test', UPSTASH_REDIS_REST_URL: 'https://test.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'redis-test', NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key', VERCEL: '1' })) vi.stubEnv(key, value);
  runtime.store = memoryStore();
  runtime.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'verified-account' } }, error: null });
  runtime.create.mockReset().mockResolvedValue('https://github.com/zenzontle/garage-guardian/issues/7');
  runtime.reconcile.mockReset().mockResolvedValue(null);
});
async function postRequest(extra: Record<string, unknown> = {}) {
  const configResponse = await configuration(new Request('https://app.test/api/bug-reports/config', { headers }));
  const config = await configResponse.json();
  const form = new FormData(); form.append('report', JSON.stringify({ ...report(), metadata: config.metadata, ...extra }));
  return new Request('https://app.test/api/bug-reports', { method: 'POST', headers, body: form });
}
describe('HTTP reporting boundary', () => {
  it('does not expose reporting when disabled or create issues with missing configuration', async () => {
    vi.stubEnv('BUG_REPORTS_ENABLED', 'false');
    expect(await (await configuration(new Request('https://app.test'))).json()).toEqual({ enabled: false });
    expect((await POST(new Request('https://app.test', { method: 'POST' }))).status).toBe(404);
    vi.stubEnv('BUG_REPORTS_ENABLED', 'true'); vi.stubEnv('BUG_REPORT_GITHUB_TOKEN', '');
    expect((await POST(new Request('https://app.test', { method: 'POST', headers }))).status).toBe(503);
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it('rejects missing authentication and expired/spoofed tokens before parsing or publishing', async () => {
    expect((await POST(new Request('https://app.test', { method: 'POST' }))).status).toBe(401);
    runtime.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect((await POST(new Request('https://app.test', { method: 'POST', headers }))).status).toBe(401);
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it('uses authoritative identity and validates before any provider writes', async () => {
    const response = await POST(await postRequest({ userId: 'spoofed' }));
    expect(response.status).toBe(422); expect(runtime.create).not.toHaveBeenCalled();
    const valid = await POST(await postRequest());
    expect(valid.status).toBe(201); expect((await valid.json()).issueUrl).toContain('/issues/7');
    expect(runtime.create.mock.calls[0][1]).not.toContain('verified-account');
  });
  it('keeps status reads scoped to the authenticated owner', async () => {
    await POST(await postRequest());
    const context = { params: Promise.resolve({ submissionId: report().submissionId }) };
    expect((await status(new Request('https://app.test', { headers }), context)).status).toBe(201);
    runtime.getUser.mockResolvedValue({ data: { user: { id: 'other-account' } }, error: null });
    expect((await status(new Request('https://app.test', { headers }), context)).status).toBe(404);
    expect((await status(new Request('https://app.test', { headers }), { params: Promise.resolve({ submissionId: 'not-uuid' }) })).status).toBe(422);
  });
  it('returns retry hints and prevents uploads when shared limits deny submission', async () => {
    const request = await postRequest();
    const { ReportError } = await import('@/lib/bug-reports/server-config');
    runtime.store.limit = vi.fn().mockRejectedValue(new ReportError(429, 'RATE_LIMITED', 'Wait', 120));
    const response = await POST(request);
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('120');
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.upload).not.toHaveBeenCalled();
  });
});

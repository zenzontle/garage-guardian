import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAccountDeletions } from '@/lib/account/account-deletion';
import { GET } from './route';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@/lib/account/account-deletion', () => ({ runAccountDeletions: vi.fn() }));
beforeEach(() => {
  vi.mocked(createClient).mockClear();
  vi.mocked(runAccountDeletions).mockReset();
  vi.stubEnv('CRON_SECRET', 'secret');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://garage.supabase.co');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'key');
  // Deletion never depends on the reminder switch.
  vi.stubEnv('REMINDERS_ENABLED', 'false');
  vi.mocked(runAccountDeletions).mockResolvedValue({ deleted: 2, failed: 0, deferred: 0 });
});
const request = (authorization = 'Bearer secret') =>
  new NextRequest('https://garage.example/api/account-deletions', { headers: { authorization } });

it('rejects unauthenticated cron calls before creating a client', async () => {
  expect((await GET(request('wrong'))).status).toBe(401);
  // Same length as the real header, so only the constant-time comparison rejects it.
  expect((await GET(request('Bearer secreT'))).status).toBe(401);
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(request('Bearer '))).status).toBe(401);
  expect(createClient).not.toHaveBeenCalled();
});
it('requires the server key', async () => {
  vi.stubEnv('SUPABASE_SECRET_KEY', '');
  const result = await GET(request());
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: { code: 'accountDeletionConfiguration' } });
  expect(runAccountDeletions).not.toHaveBeenCalled();
});
it('reports aggregate counts and surfaces failed deletions', async () => {
  const done = await GET(request());
  expect(done.status).toBe(200);
  expect(done.headers.get('cache-control')).toBe('no-store');
  expect(await done.json()).toEqual({ status: 'completed', deleted: 2, failed: 0, deferred: 0 });
  vi.mocked(runAccountDeletions).mockResolvedValueOnce({ deleted: 1, failed: 1, deferred: 1 });
  const partial = await GET(request());
  expect(partial.status).toBe(502);
  expect(await partial.json()).toEqual({
    status: 'partial_failure',
    deleted: 1,
    failed: 1,
    deferred: 1,
  });
});
it('hides internal errors from the response', async () => {
  vi.mocked(runAccountDeletions).mockRejectedValueOnce(new Error('database password leaked'));
  const result = await GET(request());
  expect(result.status).toBe(502);
  expect(await result.json()).toEqual({ error: { code: 'accountDeletionRunFailed' } });
});

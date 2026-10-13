import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runReminders } from '@/lib/reminders/worker';
import { GET } from './route';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@/lib/reminders/worker', () => ({ runReminders: vi.fn() }));
beforeEach(() => {
  for (const [name, value] of Object.entries({
    CRON_SECRET: 'secret',
    REMINDERS_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: 'https://garage.supabase.co',
    SUPABASE_SECRET_KEY: 'key',
    BREVO_API_KEY: 'email-key',
    BREVO_SENDER_EMAIL: 'sender@example.com',
    REMINDER_APP_ORIGIN: 'https://garage.example',
  }))
    vi.stubEnv(name, value);
  vi.mocked(runReminders).mockResolvedValue({
    accepted: 2,
    failed: 0,
    unknown: 0,
    skipped: 0,
    deferred: 0,
    errors: 0,
  });
});
const request = (authorization = 'Bearer secret') =>
  new NextRequest('https://garage.example/api/reminders', { headers: { authorization } });
it('rejects unauthenticated cron calls before creating a client', async () => {
  expect((await GET(request('wrong'))).status).toBe(401);
  expect(createClient).not.toHaveBeenCalled();
});
it('defaults to disabled and does no work', async () => {
  vi.stubEnv('REMINDERS_ENABLED', '');
  expect(await (await GET(request())).json()).toEqual({ status: 'email_disabled' });
  expect(runReminders).not.toHaveBeenCalled();
});
it.each(['BREVO_API_KEY', 'SUPABASE_SECRET_KEY', 'BREVO_SENDER_EMAIL', 'REMINDER_APP_ORIGIN'])(
  'fails closed when %s is missing',
  async (name) => {
    vi.stubEnv(name, '');
    expect((await GET(request())).status).toBe(503);
    expect(runReminders).not.toHaveBeenCalled();
  },
);
it('sends without the legacy single-recipient setting and returns aggregate counts', async () => {
  vi.stubEnv('REMINDER_TO_EMAIL', '');
  expect(await (await GET(request())).json()).toMatchObject({ status: 'completed', accepted: 2 });
});
it('reports errors without leaking provider details', async () => {
  vi.mocked(runReminders).mockRejectedValue(new Error('secret body'));
  const response = await GET(request());
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('secret body');
});

import { beforeEach, expect, it, vi } from 'vitest';
import { notificationRequest } from './notification-client';
import { supabase } from './repository';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./repository', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
beforeEach(() => {
  vi.mocked(supabase!.auth.getSession).mockResolvedValue({
    data: {
      session: {
        user: { id: 'alice' },
        access_token: 'token',
      },
    },
    error: null,
  } as Awaited<ReturnType<SupabaseClient['auth']['getSession']>>);
});
it('does not apply an old account form to a newly signed-in account', async () => {
  const send = vi.fn();
  vi.stubGlobal('fetch', send);
  await expect(
    notificationRequest('bob', new AbortController().signal, { enabled: true }),
  ).rejects.toMatchObject({ code: 'sessionExpired' });
  expect(send).not.toHaveBeenCalled();
});
it('validates server responses and sends only authenticated preference changes', async () => {
  const send = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          preferences: { enabled: false, weekday: 1, emailLanguage: 'es', nextScheduledAt: null },
        }),
      ),
  );
  vi.stubGlobal('fetch', send);
  await expect(
    notificationRequest('alice', new AbortController().signal, { enabled: false }),
  ).resolves.toMatchObject({ emailLanguage: 'es' });
  expect(send).toHaveBeenCalledWith(
    '/api/notification-preferences',
    expect.objectContaining({
      method: 'PATCH',
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      body: '{"enabled":false}',
    }),
  );
  send.mockResolvedValue(new Response('{}'));
  await expect(notificationRequest('alice', new AbortController().signal)).rejects.toMatchObject({
    code: 'notificationSave',
  });
});

import { beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { reminderStore } from '@/lib/reminders/store.test-helper';
import { GET, PATCH } from './route';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
let store: ReturnType<typeof reminderStore>;
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://garage.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'public-key');
  store = reminderStore();
  vi.mocked(createClient).mockReturnValue(store.db as ReturnType<typeof createClient>);
});
const request = (body?: unknown, token = 'session') =>
  new Request('https://garage.example/api/notification-preferences', {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

it('requires a verified session', async () => {
  expect((await GET(new Request('https://garage.example'))).status).toBe(401);
  store.getUser.mockResolvedValue({ data: { user: null! }, error: null });
  expect((await PATCH(request({ enabled: true }))).status).toBe(401);
  expect(store.calls).toHaveLength(0);
});
it('returns null for an unenrolled account without creating a row', async () => {
  const response = await GET(request());
  expect(await response.json()).toEqual({ preferences: null });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(store.tables.notification_preferences).toHaveLength(0);
});
it('reads and updates only the authenticated owner with its JWT', async () => {
  store.addAccount('owner');
  store.addAccount('other', 'es');
  const response = await PATCH(request({ enabled: false }));
  expect(await response.json()).toMatchObject({
    preferences: { enabled: false, weekday: 1, emailLanguage: 'en' },
  });
  expect(store.tables.notification_preferences[1].enabled).toBe(true);
  expect(createClient).toHaveBeenCalledWith(
    expect.any(String),
    'public-key',
    expect.objectContaining({
      global: { headers: { Authorization: 'Bearer session' } },
    }),
  );
});
it('creates preferences with defaults and preserves omitted fields on PATCH', async () => {
  expect((await PATCH(request({ weekday: 4, emailLanguage: 'es' }))).status).toBe(200);
  expect(await (await PATCH(request({ enabled: true }))).json()).toMatchObject({
    preferences: {
      enabled: true,
      weekday: 4,
      emailLanguage: 'es',
    },
  });
});
it.each([
  { user_id: 'other' },
  { nextScheduledAt: '2020-01-01' },
  { consent_at: '2020-01-01' },
  { weekday: 7 },
  { weekday: -1 },
  { weekday: 1.5 },
  { emailLanguage: 'fr' },
  { enabled: 'yes' },
  {},
])('rejects invalid and server-owned fields %j', async (body) => {
  expect((await PATCH(request(body))).status).toBe(400);
  expect(store.calls).toHaveLength(0);
});
it('rejects malformed and oversized bodies', async () => {
  for (const [body, status] of [
    ['{', 400],
    ['x'.repeat(2049), 413],
  ] as const) {
    const response = await PATCH(
      new Request('https://garage.example', {
        method: 'PATCH',
        headers: { authorization: 'Bearer token' },
        body,
      }),
    );
    expect(response.status).toBe(status);
  }
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GET } from './route';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  for (const [name, value] of Object.entries({
    CRON_SECRET: 'test-secret', NEXT_PUBLIC_SUPABASE_URL: 'https://garage.supabase.co',
    SUPABASE_SECRET_KEY: 'test-key', BREVO_API_KEY: 'email-key',
    BREVO_SENDER_EMAIL: 'sender@example.com', REMINDER_TO_EMAIL: 'owner@example.com',
  })) vi.stubEnv(name, value);
});
afterEach(() => { vi.useRealTimers(); });

it.each([
  ['miles', 500, 500, 'sent'],
  ['miles', 500, 501, 'nothing_due'],
  ['kilometers', 1000, 1000, 'sent'],
  ['kilometers', 1000, 1001, 'nothing_due'],
  ['kilometers', null, 1000, 'sent'],
  ['kilometers', 0, 1, 'nothing_due'],
  [undefined, 500, 500, 'sent'],
] as const)('classifies %s reminders with window %s and %s remaining', async (unit, window, remaining, status) => {
  const tables: Record<string, unknown[]> = {
    cars: [{ id: 'car', name: 'Daily driver', odometer: 5000 - remaining, distance_unit: unit, reminder_days: 30, reminder_miles: window }],
    schedule_items: [{ id: 'task', car_id: 'car', name: 'Oil change', interval_miles: 5000, interval_months: null, first_due_miles: 5000, first_due_date: null, is_active: true }],
    visits: [],
  };
  const from = vi.fn((table: string) => {
    const query = { select: () => query, eq: async () => ({ data: tables[table], error: null }), insert: async () => ({ error: null }) };
    return query;
  });
  vi.mocked(createClient).mockReturnValue({ from, auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'owner', email: 'owner@example.com' }] }, error: null }) } } } as unknown as ReturnType<typeof createClient>);
  const send = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', send);
  const response = await GET(new NextRequest('http://localhost/api/reminders', { headers: { authorization: 'Bearer test-secret' } }));
  expect(await response.json()).toMatchObject({ status });
  expect(send).toHaveBeenCalledTimes(status === 'sent' ? 1 : 0);
  if (status === 'sent') {
    const body = JSON.parse((send.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.htmlContent).toContain('coming up');
    expect(body.htmlContent).toContain('odometer readings');
  }
});

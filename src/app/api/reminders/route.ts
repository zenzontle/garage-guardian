import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { reminderOrigin } from '@/lib/reminders/email';
import { runReminders } from '@/lib/reminders/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`)
    return reply({ error: { code: 'unauthorized' } }, 401);
  if (process.env.REMINDERS_ENABLED !== 'true') return reply({ status: 'email_disabled' });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL;
  let origin: string;
  try {
    origin = reminderOrigin(process.env.REMINDER_APP_ORIGIN);
    if (!url || !key || !apiKey || !sender) throw new Error('configuration');
  } catch {
    return reply({ error: { code: 'reminderConfiguration' } }, 503);
  }
  const started = Date.now();
  // Bound the whole SDK workload as well as individual network calls.
  const budget = AbortSignal.timeout(48_000);
  const db = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            budget,
            AbortSignal.timeout(5_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    },
  });
  try {
    const counts = await runReminders(
      db,
      { origin, sender: sender!, apiKey: apiKey! },
      new Date(started),
      started + 30_000,
    );
    console.info('reminder_run', counts);
    return reply(
      { status: counts.errors ? 'partial_failure' : 'completed', ...counts },
      counts.errors ? 502 : 200,
    );
  } catch {
    console.error('reminder_run_failed');
    return reply({ error: { code: 'reminderRunFailed' } }, 502);
  }
}

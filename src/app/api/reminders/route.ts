import { NextRequest } from 'next/server';
import { reminderOrigin } from '@/lib/reminders/email';
import { runReminders } from '@/lib/reminders/worker';
import { cronClient, noStoreJson as reply } from '@/lib/utils/cron-route';
import { cronAuthorized } from '@/lib/utils/cron-secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET))
    return reply({ error: { code: 'unauthorized' } }, 401);
  if (process.env.REMINDERS_ENABLED !== 'true') return reply({ status: 'email_disabled' });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL;
  let origin: string;
  try {
    origin = reminderOrigin(process.env.REMINDER_APP_ORIGIN);
  } catch {
    return reply({ error: { code: 'reminderConfiguration' } }, 503);
  }
  if (!url || !key || !apiKey || !sender)
    return reply({ error: { code: 'reminderConfiguration' } }, 503);
  const started = Date.now();
  const db = cronClient(url, key, { callMs: 5_000 });
  try {
    const counts = await runReminders(
      db,
      { origin, sender, apiKey },
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

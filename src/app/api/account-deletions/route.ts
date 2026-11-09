import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAccountDeletions } from '@/lib/account/account-deletion';
import { cronAuthorized } from '@/lib/utils/cron-secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Retries account deletion orders that the account API could not finish inline.
// Unlike reminders, this job has no enable switch: a requested deletion must always complete.
export async function GET(request: NextRequest) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET))
    return reply({ error: { code: 'unauthorized' } }, 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return reply({ error: { code: 'accountDeletionConfiguration' } }, 503);
  const started = Date.now();
  // Bound the whole SDK workload as well as individual network calls.
  const budget = AbortSignal.timeout(48_000);
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            budget,
            AbortSignal.timeout(8_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    },
  });
  try {
    const totals = await runAccountDeletions(db, started + 40_000);
    console.info('account_deletion_run', totals);
    return reply(
      { status: totals.failed ? 'partial_failure' : 'completed', ...totals },
      totals.failed ? 502 : 200,
    );
  } catch {
    console.error('account_deletion_run_failed');
    return reply({ error: { code: 'accountDeletionRunFailed' } }, 502);
  }
}

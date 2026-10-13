import type { SupabaseClient } from '@supabase/supabase-js';
import type { PreferenceRow } from '@/lib/notification-preferences';
import { loadReminderItems } from './maintenance';
import { renderDigest } from './email';

type Outcome = 'accepted' | 'failed' | 'unknown' | 'skipped';
export type ReminderConfig = { origin: string; sender: string; apiKey: string };
type Totals = Record<Outcome | 'deferred' | 'errors', number>;

async function processAccount(
  db: SupabaseClient,
  userId: string,
  config: ReminderConfig,
  now: Date,
): Promise<Outcome> {
  const claim = await db.rpc('claim_reminder', { p_user_id: userId });
  if (claim.error) throw new Error('claim_failed');
  if (!claim.data) return 'skipped';
  const week = claim.data as string;
  let status: Outcome = 'failed';
  let code: string | null = null;
  let messageId: string | null = null;
  let count = 0;
  let sending = false;
  try {
    const items = await loadReminderItems(db, userId, now.toISOString().slice(0, 10));
    count = items.length;
    if (!count) {
      status = 'skipped';
      code = 'nothing_due';
    } else {
      // Fresh reads directly before the provider call catch opt-outs and confirmed email changes.
      const [preferences, identity] = await Promise.all([
        db.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle(),
        db.auth.admin.getUserById(userId),
      ]);
      if (preferences.error || identity.error) throw new Error('account_load');
      const user = identity.data.user;
      if (
        !preferences.data?.enabled ||
        !user?.email ||
        !user.email_confirmed_at ||
        user.is_anonymous
      ) {
        status = 'skipped';
        code = 'account_ineligible';
      } else {
        const email = renderDigest(
          items,
          (preferences.data as PreferenceRow).email_language,
          config.origin,
        );
        sending = true;
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          signal: AbortSignal.timeout(8_000),
          headers: { 'api-key': config.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            sender: { email: config.sender, name: 'Garage Guardian' },
            to: [{ email: user.email }],
            ...email,
          }),
        });
        if (response.ok) {
          status = 'accepted';
          // A malformed optional response body does not undo a definitive success status.
          const body: unknown = await response.json().catch(() => null);
          if (
            body &&
            typeof body === 'object' &&
            'messageId' in body &&
            typeof body.messageId === 'string' &&
            body.messageId.length <= 512
          )
            messageId = body.messageId;
        } else {
          status = response.status >= 500 || response.status === 408 ? 'unknown' : 'failed';
          code = `provider_${response.status}`;
        }
      }
    }
  } catch {
    status = sending ? 'unknown' : 'failed';
    code = sending ? 'provider_outcome_unknown' : 'account_processing_failed';
  }
  const saved = await db
    .from('reminder_deliveries')
    .update({
      status,
      completed_at: new Date().toISOString(),
      item_count: count,
      provider_message_id: messageId,
      failure_code: code,
    })
    .eq('user_id', userId)
    .eq('week_start', week)
    .eq('status', 'processing');
  // Never retry a provider call because saving its outcome failed.
  if (saved.error) throw new Error('outcome_save_failed');
  return status;
}

export async function runReminders(
  db: SupabaseClient,
  config: ReminderConfig,
  now = new Date(),
  deadline = Date.now() + 35_000,
) {
  const totals: Totals = { accepted: 0, failed: 0, unknown: 0, skipped: 0, deferred: 0, errors: 0 };
  const cutoff = now.toISOString();
  const [expired, stale] = await Promise.all([
    db
      .from('reminder_deliveries')
      .delete()
      .lt('attempted_at', new Date(now.getTime() - 90 * 86400000).toISOString()),
    db
      .from('reminder_deliveries')
      .update({ status: 'unknown', failure_code: 'processing_abandoned', completed_at: cutoff })
      .eq('status', 'processing')
      .lt('attempted_at', new Date(now.getTime() - 10 * 60_000).toISOString()),
  ]);
  if (expired.error || stale.error) throw new Error('delivery_maintenance_failed');
  let cursor: PreferenceRow | undefined;
  while (Date.now() < deadline) {
    let query = db
      .from('notification_preferences')
      .select('*')
      .eq('enabled', true)
      .lte('next_scheduled_at', cutoff)
      .order('next_scheduled_at')
      .order('user_id')
      .limit(50);
    if (cursor)
      query = query.or(
        `next_scheduled_at.gt.${cursor.next_scheduled_at},and(next_scheduled_at.eq.${cursor.next_scheduled_at},user_id.gt.${cursor.user_id})`,
      );
    const { data, error } = await query;
    if (error) throw new Error('preferences_load_failed');
    const page = (data ?? []) as PreferenceRow[];
    if (!page.length) break;
    for (let start = 0; start < page.length && Date.now() < deadline; start += 3) {
      const batch = page.slice(start, start + 3);
      const results = await Promise.allSettled(
        batch.map((row) => processAccount(db, row.user_id, config, now)),
      );
      for (const result of results) {
        if (result.status === 'fulfilled') totals[result.value]++;
        else totals.errors++;
      }
      cursor = batch[batch.length - 1];
    }
    if (page.length < 50) break;
  }
  const remaining = await db
    .from('notification_preferences')
    .select('user_id', { count: 'exact', head: true })
    .eq('enabled', true)
    .lte('next_scheduled_at', cutoff);
  if (remaining.error) throw new Error('backlog_count_failed');
  totals.deferred = remaining.count ?? 0;
  return totals;
}

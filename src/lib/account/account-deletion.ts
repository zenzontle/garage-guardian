import type { SupabaseClient } from '@supabase/supabase-js';

// Server-only processing of queued account deletion orders (public.account_deletion_requests).
// Every call uses a secret-key client; none of these functions may run in the browser.

const PHOTO_BUCKET = 'visit-photos';
const PHOTO_PAGE = 1000;
const CLAIM_PAGE = 10;
// Long enough that a banned account cannot sign in again before the order completes.
const BAN_DURATION = '876000h';

export type DeletionFailure =
  | 'request_failed'
  | 'claim_failed'
  | 'deadline'
  | 'photo_list_failed'
  | 'photo_path_mismatch'
  | 'photo_delete_failed'
  | 'photo_delete_stalled'
  | 'user_delete_failed';
export class DeletionError extends Error {
  constructor(readonly code: DeletionFailure) {
    super(code);
    this.name = 'DeletionError';
  }
}
export type DeletionTotals = { deleted: number; failed: number; deferred: number };

/** Records the order durably, stops reminders, and blocks new sign-ins for the account. */
export async function requestAccountDeletion(db: SupabaseClient, userId: string) {
  const { error } = await db.rpc('request_account_deletion', { p_user_id: userId });
  if (error) throw new DeletionError('request_failed');
  // The order is already durable; a failed ban only leaves sign-in open until it completes.
  const banned = await db.auth.admin
    .updateUserById(userId, { ban_duration: BAN_DURATION })
    .catch(() => ({ error: true }));
  return { banned: !banned.error };
}

async function deletePhotos(db: SupabaseClient, userId: string, deadline: number) {
  const folder = `${userId}/`;
  let previous: string | null = null;
  while (true) {
    if (Date.now() >= deadline) throw new DeletionError('deadline');
    const { data, error } = await db.rpc('account_photo_paths', {
      p_user_id: userId,
      p_limit: PHOTO_PAGE,
    });
    if (error) throw new DeletionError('photo_list_failed');
    const paths = ((data ?? []) as { name: string }[]).map((row) => row.name);
    if (!paths.length) return;
    // Never remove anything outside the account's own folder, whatever the database returns.
    if (paths.some((path) => typeof path !== 'string' || !path.startsWith(folder)))
      throw new DeletionError('photo_path_mismatch');
    const page = paths.join('\n');
    if (page === previous) throw new DeletionError('photo_delete_stalled');
    previous = page;
    const removed = await db.storage.from(PHOTO_BUCKET).remove(paths);
    if (removed.error) throw new DeletionError('photo_delete_failed');
  }
}

/** Deletes one claimed account: photos first, then the auth user, which cascades to all rows. */
export async function deleteAccountData(db: SupabaseClient, userId: string, deadline: number) {
  await deletePhotos(db, userId, deadline);
  if (Date.now() >= deadline) throw new DeletionError('deadline');
  const { error } = await db.auth.admin.deleteUser(userId);
  // A user already removed (by an earlier attempt or an administrator) is complete.
  if (error && error.status !== 404 && error.code !== 'user_not_found')
    throw new DeletionError('user_delete_failed');
}

async function recordFailure(db: SupabaseClient, userId: string, cause: unknown) {
  const code = cause instanceof DeletionError ? cause.code : 'user_delete_failed';
  // The lease stays, so this run does not retry immediately; a later run retries once it expires.
  await Promise.resolve(
    db.from('account_deletion_requests').update({ failure_code: code }).eq('user_id', userId),
  ).catch(() => {});
}

async function processClaimed(db: SupabaseClient, userId: string, deadline: number) {
  try {
    await deleteAccountData(db, userId, deadline);
    return true;
  } catch (cause) {
    await recordFailure(db, userId, cause);
    return false;
  }
}

/**
 * Tries to complete one account's queued order now. Returns false when it stays queued:
 * another worker holds its lease, or an attempt failed and the worker will retry it.
 */
export async function processAccountDeletion(
  db: SupabaseClient,
  userId: string,
  deadline: number,
): Promise<boolean> {
  const { data, error } = await db.rpc('claim_account_deletions', {
    p_limit: 1,
    p_user_id: userId,
  });
  if (error) return false;
  const claimed = ((data ?? []) as { user_id: string }[]).some((row) => row.user_id === userId);
  return claimed && processClaimed(db, userId, deadline);
}

/** Worker: drains queued orders oldest first until the deadline, then reports the backlog. */
export async function runAccountDeletions(
  db: SupabaseClient,
  deadline: number,
): Promise<DeletionTotals> {
  const totals: DeletionTotals = { deleted: 0, failed: 0, deferred: 0 };
  const attempted = new Set<string>();
  while (Date.now() < deadline) {
    const { data, error } = await db.rpc('claim_account_deletions', { p_limit: CLAIM_PAGE });
    if (error) throw new DeletionError('claim_failed');
    const claimed = ((data ?? []) as { user_id: string }[])
      .map((row) => row.user_id)
      .filter((id) => !attempted.has(id));
    if (!claimed.length) break;
    for (const userId of claimed) {
      attempted.add(userId);
      if (Date.now() >= deadline) {
        // Release unstarted claims so the next run picks them up without waiting for the lease.
        await Promise.resolve(
          db.from('account_deletion_requests').update({ locked_until: null }).eq('user_id', userId),
        ).catch(() => {});
        continue;
      }
      if (await processClaimed(db, userId, deadline)) totals.deleted++;
      else totals.failed++;
    }
  }
  const remaining = await db
    .from('account_deletion_requests')
    .select('user_id', { count: 'exact', head: true });
  if (remaining.error) throw new DeletionError('claim_failed');
  totals.deferred = remaining.count ?? 0;
  return totals;
}

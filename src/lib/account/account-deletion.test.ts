// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DeletionError,
  processAccountDeletion,
  requestAccountDeletion,
  runAccountDeletions,
} from './account-deletion';

const owner = '44444444-4444-4444-8444-444444444444';
const other = '55555555-5555-4555-8555-555555555555';

type Request = { locked: boolean; failure?: string };
function deletionStore(photos: string[] = [], queued: string[] = []) {
  const objects = new Set(photos);
  const queue = new Map<string, Request>(queued.map((id) => [id, { locked: false }]));
  const users = new Set([owner, other, ...queued]);
  const events: string[] = [];
  let listOverride: ((userId: string) => string[]) | null = null;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'request_account_deletion') {
      queue.set(args.p_user_id as string, queue.get(args.p_user_id as string) ?? { locked: false });
      return { data: '2026-11-07T00:00:00Z', error: null };
    }
    if (name === 'claim_account_deletions') {
      const ids = [...queue.entries()]
        .filter(([id, request]) => !request.locked && (!args.p_user_id || id === args.p_user_id))
        .slice(0, args.p_limit as number)
        .map(([id]) => id);
      for (const id of ids) queue.get(id)!.locked = true;
      return { data: ids.map((user_id) => ({ user_id })), error: null };
    }
    if (name === 'account_photo_paths') {
      const userId = args.p_user_id as string;
      const names = listOverride
        ? listOverride(userId)
        : [...objects].filter((path) => path.startsWith(`${userId}/`)).sort();
      return {
        data: names.slice(0, args.p_limit as number).map((path) => ({ name: path })),
        error: null,
      };
    }
    return { data: null, error: { code: 'unknown_rpc' } };
  });
  const remove = vi.fn(async (paths: string[]) => {
    events.push(`remove:${paths.length}`);
    for (const path of paths) objects.delete(path);
    return { data: [], error: null as { message: string } | null };
  });
  type AuthResult = { data: object | null; error: { status?: number; code?: string } | null };
  const deleteUser = vi.fn(async (id: string): Promise<AuthResult> => {
    events.push(`deleteUser:${id}`);
    if (!users.has(id)) return { data: null, error: { status: 404, code: 'user_not_found' } };
    users.delete(id);
    queue.delete(id);
    return { data: {}, error: null };
  });
  const updateUserById = vi.fn(async (id: string, attributes: Record<string, unknown>) => {
    events.push(`ban:${id}:${String(attributes.ban_duration)}`);
    return { data: {}, error: null as Error | null };
  });
  const from = vi.fn((table: string) => ({
    update: (values: Record<string, unknown>) => ({
      eq: async (_key: string, id: string) => {
        const request = queue.get(id);
        if (table === 'account_deletion_requests' && request) {
          if (typeof values.failure_code === 'string') request.failure = values.failure_code;
          if (values.locked_until === null) request.locked = false;
        }
        return { error: null };
      },
    }),
    select: async () => ({ count: queue.size, error: null }),
  }));
  const db = {
    rpc,
    from,
    storage: { from: () => ({ remove }) },
    auth: { admin: { deleteUser, updateUserById } },
  } as unknown as SupabaseClient;
  return {
    db,
    objects,
    queue,
    users,
    events,
    rpc,
    remove,
    deleteUser,
    updateUserById,
    listInstead: (list: (userId: string) => string[]) => {
      listOverride = list;
    },
  };
}
const later = () => Date.now() + 10_000;

describe('requestAccountDeletion', () => {
  it('enqueues the order before banning sign-ins for the account', async () => {
    const store = deletionStore();
    expect(await requestAccountDeletion(store.db, owner)).toEqual({ banned: true });
    expect(store.rpc).toHaveBeenCalledWith('request_account_deletion', { p_user_id: owner });
    expect(store.queue.has(owner)).toBe(true);
    expect(store.updateUserById).toHaveBeenCalledWith(owner, { ban_duration: '876000h' });
  });
  it('fails without banning when the order cannot be recorded', async () => {
    const store = deletionStore();
    store.rpc.mockResolvedValueOnce({ data: null, error: { code: '23503' } });
    await expect(requestAccountDeletion(store.db, owner)).rejects.toEqual(
      new DeletionError('request_failed'),
    );
    expect(store.updateUserById).not.toHaveBeenCalled();
  });
  it('keeps a recorded order when the ban fails', async () => {
    const store = deletionStore();
    store.updateUserById.mockRejectedValueOnce(new Error('offline'));
    expect(await requestAccountDeletion(store.db, owner)).toEqual({ banned: false });
    expect(store.queue.has(owner)).toBe(true);
  });
});

describe('processAccountDeletion', () => {
  it('removes every photo page before deleting the auth user', async () => {
    const photos = Array.from({ length: 2500 }, (_, index) => `${owner}/visit-${index}/p.webp`);
    const store = deletionStore([...photos, `${other}/visit/p.webp`], [owner]);
    expect(await processAccountDeletion(store.db, owner, later())).toBe(true);
    expect(store.events).toEqual([
      'remove:1000',
      'remove:1000',
      'remove:500',
      `deleteUser:${owner}`,
    ]);
    expect([...store.objects]).toEqual([`${other}/visit/p.webp`]);
    expect(store.users.has(other)).toBe(true);
    expect(store.queue.has(owner)).toBe(false);
  });
  it('does nothing when another worker holds the lease', async () => {
    const store = deletionStore([`${owner}/visit/p.webp`], [owner]);
    store.queue.get(owner)!.locked = true;
    expect(await processAccountDeletion(store.db, owner, later())).toBe(false);
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deleteUser).not.toHaveBeenCalled();
  });
  it('never removes a path outside the account folder', async () => {
    const store = deletionStore([`${owner}/visit/p.webp`], [owner]);
    store.listInstead(() => [`${owner}/visit/p.webp`, `${other}/visit/p.webp`]);
    expect(await processAccountDeletion(store.db, owner, later())).toBe(false);
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.deleteUser).not.toHaveBeenCalled();
    expect(store.queue.get(owner)?.failure).toBe('photo_path_mismatch');
  });
  it('keeps the user and records a failure when storage removal fails or stalls', async () => {
    const failing = deletionStore([`${owner}/visit/p.webp`], [owner]);
    failing.remove.mockResolvedValueOnce({ data: [], error: { message: 'storage offline' } });
    expect(await processAccountDeletion(failing.db, owner, later())).toBe(false);
    expect(failing.deleteUser).not.toHaveBeenCalled();
    expect(failing.queue.get(owner)).toEqual({ locked: true, failure: 'photo_delete_failed' });

    const stalled = deletionStore([`${owner}/visit/p.webp`], [owner]);
    stalled.remove.mockResolvedValue({ data: [], error: null });
    expect(await processAccountDeletion(stalled.db, owner, later())).toBe(false);
    expect(stalled.remove).toHaveBeenCalledTimes(1);
    expect(stalled.deleteUser).not.toHaveBeenCalled();
    expect(stalled.queue.get(owner)?.failure).toBe('photo_delete_stalled');
  });
  it('stops at the deadline without deleting the user', async () => {
    const store = deletionStore([`${owner}/visit/p.webp`], [owner]);
    expect(await processAccountDeletion(store.db, owner, Date.now() - 1)).toBe(false);
    expect(store.deleteUser).not.toHaveBeenCalled();
    expect(store.queue.get(owner)?.failure).toBe('deadline');
  });
  it('treats an already deleted user as complete and other auth errors as failures', async () => {
    const gone = deletionStore([], [owner]);
    gone.users.delete(owner);
    expect(await processAccountDeletion(gone.db, owner, later())).toBe(true);

    const failing = deletionStore([], [owner]);
    failing.deleteUser.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    expect(await processAccountDeletion(failing.db, owner, later())).toBe(false);
    expect(failing.queue.get(owner)?.failure).toBe('user_delete_failed');
  });
});

describe('runAccountDeletions', () => {
  it('drains the queue once per run and reports failures and the remaining backlog', async () => {
    const queued = Array.from(
      { length: 12 },
      (_, index) => `66666666-6666-4666-8666-${String(index).padStart(12, '0')}`,
    );
    const store = deletionStore(
      queued.map((id) => `${id}/visit/p.webp`),
      queued,
    );
    store.deleteUser.mockImplementation(async (id: string) => {
      if (id === queued[3]) return { data: null, error: { status: 500 } };
      store.users.delete(id);
      store.queue.delete(id);
      return { data: {}, error: null };
    });
    expect(await runAccountDeletions(store.db, later())).toEqual({
      deleted: 11,
      failed: 1,
      deferred: 1,
    });
    expect(store.deleteUser).toHaveBeenCalledTimes(12);
    expect(store.queue.get(queued[3])?.failure).toBe('user_delete_failed');
  });
  it('fails the run when the queue cannot be claimed', async () => {
    const store = deletionStore([], [owner]);
    store.rpc.mockResolvedValueOnce({ data: null, error: { code: 'timeout' } });
    await expect(runAccountDeletions(store.db, later())).rejects.toEqual(
      new DeletionError('claim_failed'),
    );
    expect(store.deleteUser).not.toHaveBeenCalled();
  });
});

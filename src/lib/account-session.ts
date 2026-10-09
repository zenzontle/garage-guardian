import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from './app-error';

// Explicitly shared with client configuration; preserve Supabase's existing key.
export const accountAuthStorageKey = (project: string) =>
  `sb-${new URL(project).hostname.split('.')[0]}-auth-token`;

type AuthWithLocalRemoval = SupabaseClient['auth'] & {
  // Supabase uses this local primitive after signOut has acquired its auth lock.
  _removeSession?: () => Promise<void>;
};

export async function clearDeletedAccountSession(
  client: SupabaseClient,
  project: string,
  userId: string,
) {
  try {
    const before = await client.auth.getSession();
    if (before.error) throw new AppError('accountDeletionSessionCleanup');
    if (before.data.session && before.data.session.user.id !== userId)
      throw new AppError('sessionChanged');
    const key = accountAuthStorageKey(project);
    const persisted = window.localStorage.getItem(key);
    if (persisted) {
      const session = JSON.parse(persisted) as { user?: { id?: string } };
      if (session.user?.id !== userId) throw new AppError('sessionChanged');
    }
    const auth = client.auth as AuthWithLocalRemoval;
    let error: unknown = null;
    try {
      if (auth._removeSession) await auth._removeSession();
      else {
        // Keep compatibility with test/custom clients that expose only the public API.
        const current = await auth.getSession();
        if (current.error) throw current.error;
        if (current.data.session?.user.id !== userId) throw new AppError('sessionChanged');
        ({ error } = await auth.signOut({ scope: 'local' }));
      }
    } catch {
      error = true;
    }
    const local = await client.auth.getSession();
    if (!error && !local.error && !local.data.session) return;
    if (local.data.session && local.data.session.user.id !== userId)
      throw new AppError('sessionChanged');
    if (local.error || local.data.session) {
      const persisted = window.localStorage.getItem(key);
      if (persisted) {
        const session = JSON.parse(persisted) as { user?: { id?: string } };
        if (session.user?.id !== userId) throw new AppError('sessionChanged');
        // Remove only this deleted account's auth credentials, never guest data.
        window.localStorage.removeItem(key);
        window.localStorage.removeItem(`${key}-user`);
      }
      // With persisted credentials gone, the SDK can clear its state and notify tabs
      // without sending the deleted user's token to the sign-out endpoint again.
      await client.auth.signOut({ scope: 'local' });
    }
    const checked = await client.auth.getSession();
    if (checked.error || checked.data.session) throw new AppError('accountDeletionSessionCleanup');
  } catch (cause) {
    if (cause instanceof AppError && cause.code === 'sessionChanged') throw cause;
    throw new AppError('accountDeletionSessionCleanup');
  }
}

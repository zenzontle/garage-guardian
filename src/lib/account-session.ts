import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from './app-error';

// Explicitly shared with client configuration; preserve Supabase's existing key.
export const accountAuthStorageKey = (project: string) =>
  `sb-${new URL(project).hostname.split('.')[0]}-auth-token`;

// Isolate the SDK's private lock primitives here. Public auth methods reacquire
// the lock and can deadlock when called from its callback.
type LockedAuth = Pick<SupabaseClient['auth'], 'initialize' | 'signInWithPassword' | 'signUp'> & {
  lock: unknown;
  _acquireLock: <R>(timeout: number, work: () => Promise<R>) => Promise<R>;
  _useSession: <R>(
    work: (result: Awaited<ReturnType<SupabaseClient['auth']['getSession']>>) => Promise<R>,
  ) => Promise<R>;
  _signOut: SupabaseClient['auth']['signOut'];
  _removeSession: () => Promise<void>;
};

export function serializeAccountSignIns(client: SupabaseClient) {
  const auth = client.auth as unknown as LockedAuth;
  // The installed SDK saves password sign-in/signup sessions without acquiring
  // its optional lock. Serialize those writes with deletion and other auth work.
  if (auth.lock && auth._acquireLock) {
    const signIn = auth.signInWithPassword.bind(auth);
    const signUp = auth.signUp.bind(auth);
    auth.signInWithPassword = async (...args) => {
      await auth.initialize();
      return auth._acquireLock(-1, () => signIn(...args));
    };
    auth.signUp = async (...args) => {
      await auth.initialize();
      return auth._acquireLock(-1, () => signUp(...args));
    };
  }
  return client;
}

export async function clearDeletedAccountSession(
  client: SupabaseClient,
  project: string,
  userId: string,
) {
  try {
    const auth = client.auth as unknown as LockedAuth;
    // Fail closed if browser locking is unavailable or the SDK contract changes.
    if (
      !auth.lock ||
      !auth._acquireLock ||
      !auth._useSession ||
      !auth._signOut ||
      !auth._removeSession
    )
      throw new AppError('accountDeletionSessionCleanup');
    await auth.initialize();
    await auth._acquireLock(-1, async () => {
      const key = accountAuthStorageKey(project);
      const checkIdentity = async () => {
        const current = await auth._useSession(async (result) => result);
        if (current.error) throw new AppError('accountDeletionSessionCleanup');
        if (current.data.session && current.data.session.user.id !== userId)
          throw new AppError('sessionChanged');
        return current.data.session;
      };
      await checkIdentity();
      const checkStorage = () => {
        const persisted = window.localStorage.getItem(key);
        if (persisted && JSON.parse(persisted).user?.id !== userId)
          throw new AppError('sessionChanged');
        return persisted;
      };
      checkStorage();
      await auth._signOut({ scope: 'local' }).catch(() => undefined);
      if (!(await checkIdentity())) return;
      if (checkStorage()) {
        // Only this account's project-scoped credentials; retain guest data.
        window.localStorage.removeItem(key);
        window.localStorage.removeItem(`${key}-user`);
      }
      await auth._removeSession();
      if (await checkIdentity()) throw new AppError('accountDeletionSessionCleanup');
    });
  } catch (cause) {
    if (cause instanceof AppError && cause.code === 'sessionChanged') throw cause;
    throw new AppError('accountDeletionSessionCleanup');
  }
}

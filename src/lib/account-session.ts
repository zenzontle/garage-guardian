import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { AppError, failureOf } from './app-error';
import { sameRecoverySession } from './account-recovery';

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
  _updateUser: SupabaseClient['auth']['updateUser'];
};

export function serializeAccountSignIns(client: SupabaseClient) {
  const auth = client.auth as unknown as LockedAuth;
  // The installed SDK saves password sign-in/signup sessions without acquiring
  // its optional lock. Serialize those writes with recovery and password completion.
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

async function readBoundSession(
  auth: LockedAuth,
  session: Session,
  code: 'auth' | 'sessionRevocation',
) {
  const current = await auth._useSession(async (result) => result);
  if (current.error) throw new AppError(code);
  if (current.data.session && !sameRecoverySession(session, current.data.session))
    throw new AppError('sessionChanged');
  return current.data.session;
}

export async function updateRecoveryPassword(
  client: SupabaseClient,
  session: Session,
  password: string,
) {
  const auth = client.auth as unknown as LockedAuth;
  if (!auth.lock || !auth._acquireLock || !auth._useSession || !auth._updateUser)
    throw new AppError('auth');
  await auth.initialize();
  await auth._acquireLock(-1, async () => {
    if (!(await readBoundSession(auth, session, 'auth'))) throw new AppError('recoveryInvalid');
    // The public method reacquires the lock; use the installed SDK primitive.
    const { error } = await auth._updateUser({ password });
    if (error) throw new AppError(failureOf({ code: error.code }, 'auth').code);
  });
}

export async function signOutPasswordSession(
  client: SupabaseClient,
  session: Session,
  scope: 'local' | 'global',
) {
  const code = scope === 'global' ? 'sessionRevocation' : 'auth';
  try {
    const auth = client.auth as unknown as LockedAuth;
    if (!auth.lock || !auth._acquireLock || !auth._useSession || !auth._signOut)
      throw new AppError(code);
    await auth.initialize();
    await auth._acquireLock(-1, async () => {
      const readSession = () => readBoundSession(auth, session, code);
      if (!(await readSession())) {
        // Local cleanup can already be complete; global revocation needs a token.
        if (scope === 'global') throw new AppError(code);
        return;
      }
      const { error } = await auth._signOut({ scope }).catch(() => ({ error: true }));
      const remaining = await readSession();
      // A lost local logout response is harmless if credentials are gone.
      if ((error && scope === 'global') || remaining) throw new AppError(code);
    });
  } catch (cause) {
    if (cause instanceof AppError && cause.code === 'sessionChanged') throw cause;
    throw new AppError(code);
  }
}

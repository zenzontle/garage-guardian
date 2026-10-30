import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { AppError, failureOf } from '../utils/app-error';
import { withNamedLock } from '../utils/named-lock';
import { sameRecoverySession } from './account-recovery';

// Explicitly shared with client configuration; preserve Supabase's existing key.
export const accountAuthStorageKey = (project: string) =>
  `sb-${new URL(project).hostname.split('.')[0]}-auth-token`;

// The client starts initialization once serializeAccountSignIns has wrapped it.
export const accountAuthOptions = (project: string) => ({
  storageKey: accountAuthStorageKey(project),
  skipAutoInitialize: true,
});

// The SDK coordinates its own token refreshes without a lock. Every other write
// to the shared session (initialization, sign-in, sign-out, password completion)
// takes this app-owned lock so tabs cannot overwrite each other's accounts.
const lockNames = new WeakMap<SupabaseClient['auth'], string>();

type InitializingAuth = { _initialize?: () => Promise<unknown> };

export function serializeAccountSignIns(client: SupabaseClient, project: string) {
  const auth = client.auth;
  const name = `garage-guardian:account:${accountAuthStorageKey(project)}`;
  lockNames.set(auth, name);
  // Initialization can detect a callback session or clear an invalid one.
  const internal = auth as unknown as InitializingAuth;
  const initialize = internal._initialize?.bind(auth);
  if (initialize) internal._initialize = () => withNamedLock(name, initialize);
  void auth.initialize().catch(() => {});
  const signIn = auth.signInWithPassword.bind(auth);
  const signUp = auth.signUp.bind(auth);
  auth.signInWithPassword = (...args) => withAccountLock(client, () => signIn(...args));
  auth.signUp = (...args) => withAccountLock(client, () => signUp(...args));
  return client;
}

function accountLock(client: SupabaseClient, code: 'auth' | 'sessionRevocation') {
  const name = lockNames.get(client.auth);
  if (!name) throw new AppError(code);
  return name;
}

export async function withAccountLock<T>(
  client: SupabaseClient,
  action: () => Promise<T>,
  code: 'auth' | 'sessionRevocation' = 'auth',
): Promise<T> {
  const name = accountLock(client, code);
  // Initialization takes the same lock; finish it first.
  await client.auth.initialize();
  return withNamedLock(name, action);
}

async function readBoundSession(
  client: SupabaseClient,
  session: Session,
  code: 'auth' | 'sessionRevocation',
) {
  const current = await client.auth.getSession();
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
  await withAccountLock(client, async () => {
    if (!(await readBoundSession(client, session, 'auth'))) throw new AppError('recoveryInvalid');
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new AppError(failureOf({ code: error.code }, 'auth').code);
  });
}

export function assertPasswordSignOutSupport(
  client: SupabaseClient,
  code: 'auth' | 'sessionRevocation' = 'auth',
) {
  accountLock(client, code);
}

export async function signOutPasswordSession(
  client: SupabaseClient,
  session: Session,
  scope: 'local' | 'global',
) {
  const code = scope === 'global' ? 'sessionRevocation' : 'auth';
  try {
    await withAccountLock(
      client,
      async () => {
        const readSession = () => readBoundSession(client, session, code);
        if (!(await readSession())) {
          // Local cleanup can already be complete; global revocation needs a token.
          if (scope === 'global') throw new AppError(code);
          return;
        }
        const { error } = await client.auth.signOut({ scope }).catch(() => ({ error: true }));
        const remaining = await readSession();
        // A lost local logout response is harmless if credentials are gone.
        if ((error && scope === 'global') || remaining) throw new AppError(code);
      },
      code,
    );
  } catch (cause) {
    if (cause instanceof AppError && cause.code === 'sessionChanged') throw cause;
    throw new AppError(code);
  }
}

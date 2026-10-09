import { beforeEach, expect, it, vi } from 'vitest';
import {
  createClient,
  navigatorLock,
  processLock,
  type SupabaseClient,
} from '@supabase/supabase-js';
import {
  accountAuthStorageKey,
  clearDeletedAccountSession,
  serializeAccountSignIns,
  signOutPasswordSession,
} from './account-session';
import { account } from '../test/fake-supabase';

const project = 'https://account-session.supabase.co';
const key = accountAuthStorageKey(project);
beforeEach(() => localStorage.clear());

function storedClient(projectUrl = project) {
  const key = accountAuthStorageKey(projectUrl);
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: account().id, exp: expires, role: 'authenticated', session_id: 'test-session' }))}.signature`;
  localStorage.setItem(
    key,
    JSON.stringify({
      user: account(),
      access_token: token,
      refresh_token: 'test-refresh',
      expires_at: expires,
      token_type: 'bearer',
    }),
  );
  const auth = {
    lock: true,
    initialize: vi.fn(async () => ({ error: null })),
    _acquireLock: vi.fn(async <R>(_timeout: number, work: () => Promise<R>) => work()),
    signOut: vi.fn<(options?: { scope: 'local' }) => Promise<{ error: Error | null }>>(
      async () => ({ error: null }),
    ),
    getSession: vi.fn(async () => ({
      data: { session: JSON.parse(localStorage.getItem(key) ?? 'null') },
      error: null,
    })),
  };
  Object.assign(auth, {
    _useSession: async <R>(
      work: (result: Awaited<ReturnType<typeof auth.getSession>>) => Promise<R>,
    ) => work(await auth.getSession()),
    _signOut: (options: { scope: 'local' }) => auth.signOut(options),
    _removeSession: async () => {
      const { error } = await auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
  });
  return { auth, key, client: { auth } as unknown as SupabaseClient };
}

it('preserves the SDK’s existing storage key and can load its persisted session before cleanup', async () => {
  const existingProject = 'https://existing-session.supabase.co';
  const { key } = storedClient(existingProject);
  const existing = createClient(existingProject, 'test-key', {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, lock: processLock },
    global: {
      fetch: vi.fn(
        async () => new Response(JSON.stringify({ message: 'User deleted' }), { status: 404 }),
      ),
    },
  });
  expect((await existing.auth.getSession()).data.session?.user.id).toBe(account().id);
  await clearDeletedAccountSession(existing, existingProject, account().id);
  expect(localStorage.getItem(key)).toBeNull();
  expect((await existing.auth.getSession()).data.session).toBeNull();
  await existing.auth.stopAutoRefresh();
});

it.each(['returned', 'thrown'] as const)(
  'clears retained credentials after a %s sign-out error and survives SDK reload',
  async (kind) => {
    const sessionProject = project.replace('account-session', `${kind}-account-session`);
    const { client, auth, key } = storedClient(sessionProject);
    if (kind === 'returned') auth.signOut.mockResolvedValueOnce({ error: new Error('Offline') });
    else auth.signOut.mockRejectedValueOnce(new Error('Offline'));
    localStorage.setItem(`${key}-user`, JSON.stringify({ user: account() }));
    localStorage.setItem('garage-guardian:locale', 'es');
    localStorage.setItem('unrelated-project-auth', 'keep');
    await clearDeletedAccountSession(client, sessionProject, account().id);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(`${key}-user`)).toBeNull();
    expect(localStorage.getItem('garage-guardian:locale')).toBe('es');
    expect(localStorage.getItem('unrelated-project-auth')).toBe('keep');
    expect(auth.signOut.mock.calls).toEqual([[{ scope: 'local' }], [{ scope: 'local' }]]);
    // Use the real SDK's default storage key to verify a fresh client stays signed out.
    const fetch = vi.fn();
    const reopened = createClient(sessionProject, 'test-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch },
    });
    expect((await reopened.auth.getSession()).data.session).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await reopened.auth.stopAutoRefresh();
  },
);

it('accepts an error response when the SDK has already cleared the session', async () => {
  const { client, auth } = storedClient();
  auth.signOut.mockImplementationOnce(async () => {
    localStorage.removeItem(key);
    return { error: new Error('Lost logout response') };
  });
  await clearDeletedAccountSession(client, project, account().id);
  expect(auth.signOut).toHaveBeenCalledTimes(1);
});

it('never clears a replacement account’s credentials', async () => {
  const { client, auth } = storedClient();
  localStorage.setItem(key, JSON.stringify({ user: account('replacement') }));
  auth.signOut.mockImplementationOnce(async () => {
    localStorage.removeItem(key);
    return { error: null };
  });
  await expect(clearDeletedAccountSession(client, project, account().id)).rejects.toMatchObject({
    code: 'sessionChanged',
  });
  expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('replacement');
  expect(auth.signOut).not.toHaveBeenCalled();
});

it('rejects a replacement that arrives after the initial session read', async () => {
  const { client, auth } = storedClient();
  auth.getSession.mockImplementationOnce(async () => {
    localStorage.setItem(key, JSON.stringify({ user: account('replacement') }));
    return { data: { session: { user: account() } }, error: null };
  });
  await expect(clearDeletedAccountSession(client, project, account().id)).rejects.toMatchObject({
    code: 'sessionChanged',
  });
  expect(auth.signOut).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('replacement');
});

it('reports cleanup failure rather than completion when persisted storage cannot be cleared', async () => {
  const { client, auth } = storedClient();
  auth.signOut.mockResolvedValueOnce({ error: new Error('Offline') });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
    throw new Error('Storage unavailable');
  });
  await expect(clearDeletedAccountSession(client, project, account().id)).rejects.toMatchObject({
    code: 'accountDeletionSessionCleanup',
  });
  expect(localStorage.getItem(key)).not.toBeNull();
});

it.each(
  (['signInWithPassword', 'signUp'] as const).flatMap((method) =>
    (['deletion', 'local', 'global'] as const).map((scope) => ({ method, scope })),
  ),
)(
  'preserves a replacement account when $scope cleanup waits for another client’s $method lock',
  async ({ method, scope }) => {
    const sessionProject = `https://${method.toLowerCase()}-${scope}-race.supabase.co`;
    const { key } = storedClient(sessionProject);
    const replacement = {
      ...JSON.parse(localStorage.getItem(key)!),
      expires_in: 3600,
      user: account('replacement'),
    };
    let release!: () => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response(JSON.stringify(replacement)));
        }),
    );
    vi.stubGlobal('navigator', {
      locks: {
        request: (
          name: string,
          _options: unknown,
          work: (lock: { name: string }) => Promise<unknown>,
        ) => processLock(name, -1, () => work({ name })),
      },
    });
    const requested = vi.fn();
    const lock: typeof navigatorLock = (name, timeout, work) => {
      requested(name);
      return navigatorLock(name, timeout, work);
    };
    const logoutFetch = vi.fn();
    const deleted = createClient(sessionProject, 'test-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, lock },
      global: { fetch: logoutFetch },
    });
    const otherTab = serializeAccountSignIns(
      createClient(sessionProject, 'test-key', {
        auth: { autoRefreshToken: false, detectSessionInUrl: false, lock },
        global: { fetch },
      }),
    );
    await Promise.all([deleted.auth.initialize(), otherTab.auth.initialize()]);
    const originalSession = (await deleted.auth.getSession()).data.session!;
    const signIn = otherTab.auth[method]({
      email: 'replacement@example.com',
      password: 'password',
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    requested.mockClear();
    const cleanup =
      scope === 'deletion'
        ? clearDeletedAccountSession(deleted, sessionProject, account().id)
        : signOutPasswordSession(deleted, originalSession, scope);
    const rejected = expect(cleanup).rejects.toMatchObject({ code: 'sessionChanged' });
    await vi.waitFor(() => expect(requested).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe(account().id);
    release();
    await signIn;
    await rejected;
    expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('replacement');
    expect((await otherTab.auth.getSession()).data.session?.user.id).toBe('replacement');
    expect(logoutFetch).not.toHaveBeenCalled();
    await Promise.all([deleted.auth.stopAutoRefresh(), otherTab.auth.stopAutoRefresh()]);
  },
);

it.each(['local', 'global'] as const)(
  'preserves a new session for the same account during %s password completion',
  async (scope) => {
    const { client, auth, key } = storedClient();
    const original = (await auth.getSession()).data.session;
    const replacement = {
      ...original,
      access_token: `header.${btoa(JSON.stringify({ session_id: 'replacement-session' }))}.signature`,
    };
    localStorage.setItem(key, JSON.stringify(replacement));
    await expect(signOutPasswordSession(client, original, scope)).rejects.toMatchObject({
      code: 'sessionChanged',
    });
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(replacement);
  },
);

it.each(['local', 'global'] as const)(
  'handles a lost %s logout response without claiming unconfirmed revocation',
  async (scope) => {
    const { client, auth, key } = storedClient();
    const original = (await auth.getSession()).data.session;
    auth.signOut.mockImplementationOnce(async () => {
      localStorage.removeItem(key);
      return { error: new Error('Lost response') };
    });
    const work = signOutPasswordSession(client, original, scope);
    if (scope === 'global') await expect(work).rejects.toMatchObject({ code: 'sessionRevocation' });
    else await work;
    expect(localStorage.getItem(key)).toBeNull();
    expect(auth.signOut).toHaveBeenCalledWith({ scope });
  },
);

it('holds the shared lock until local removal finishes before another client can sign in', async () => {
  const sessionProject = 'https://removal-race.supabase.co';
  const { key } = storedClient(sessionProject);
  const replacement = {
    ...JSON.parse(localStorage.getItem(key)!),
    expires_in: 3600,
    user: account('replacement'),
  };
  let release!: () => void;
  let removing = false;
  const deleted = createClient(sessionProject, 'test-key', {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      lock: processLock,
      storage: {
        getItem: (name) => localStorage.getItem(name),
        setItem: (name, value) => localStorage.setItem(name, value),
        removeItem: async (name) => {
          if (name === key) {
            removing = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          localStorage.removeItem(name);
        },
      },
    },
    global: { fetch: vi.fn(async () => new Response('{}', { status: 404 })) },
  });
  const fetch = vi.fn(async () => new Response(JSON.stringify(replacement)));
  const otherTab = serializeAccountSignIns(
    createClient(sessionProject, 'test-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, lock: processLock },
      global: { fetch },
    }),
  );
  await Promise.all([deleted.auth.initialize(), otherTab.auth.initialize()]);
  const cleanup = clearDeletedAccountSession(deleted, sessionProject, account().id);
  await vi.waitFor(() => expect(removing).toBe(true));
  const signIn = otherTab.auth.signInWithPassword({
    email: 'replacement@example.com',
    password: 'password',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetch).not.toHaveBeenCalled();
  release();
  await cleanup;
  await signIn;
  expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('replacement');
  await Promise.all([deleted.auth.stopAutoRefresh(), otherTab.auth.stopAutoRefresh()]);
});

it.each(['deletion', 'local', 'global'] as const)(
  'fails closed for %s cleanup when no shared auth lock is configured',
  async (scope) => {
    const sessionProject = 'https://no-lock.supabase.co';
    const { key } = storedClient(sessionProject);
    const fetch = vi.fn();
    const client = createClient(sessionProject, 'test-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch },
    });
    await client.auth.initialize();
    const session = (await client.auth.getSession()).data.session!;
    await expect(
      scope === 'deletion'
        ? clearDeletedAccountSession(client, sessionProject, account().id)
        : signOutPasswordSession(client, session, scope),
    ).rejects.toMatchObject({
      code:
        scope === 'deletion'
          ? 'accountDeletionSessionCleanup'
          : scope === 'global'
            ? 'sessionRevocation'
            : 'auth',
    });
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await client.auth.stopAutoRefresh();
  },
);

it.each(['local', 'global'] as const)(
  'does not attempt %s revocation without a current session',
  async (scope) => {
    const { client, auth, key } = storedClient();
    const original = (await auth.getSession()).data.session;
    localStorage.removeItem(key);
    const work = signOutPasswordSession(client, original, scope);
    if (scope === 'global') await expect(work).rejects.toMatchObject({ code: 'sessionRevocation' });
    else await work;
    expect(auth.signOut).not.toHaveBeenCalled();
  },
);

import { beforeEach, expect, it, vi } from 'vitest';
import {
  createClient,
  navigatorLock,
  processLock,
  type SupabaseClient,
} from '@supabase/supabase-js';
import {
  accountAuthStorageKey,
  serializeAccountSignIns,
  signOutPasswordSession,
  updateRecoveryPassword,
} from './account-session';
import { account } from '../test/fake-supabase';

const project = 'https://account-session.supabase.co';
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
    _updateUser: vi.fn(async () => ({ data: { user: account() }, error: null })),
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
        async () => new Response(JSON.stringify({ message: 'Session expired' }), { status: 404 }),
      ),
    },
  });
  expect((await existing.auth.getSession()).data.session?.user.id).toBe(account().id);
  await signOutPasswordSession(existing, (await existing.auth.getSession()).data.session!, 'local');
  expect(localStorage.getItem(key)).toBeNull();
  expect((await existing.auth.getSession()).data.session).toBeNull();
  await existing.auth.stopAutoRefresh();
});

it.each(
  (['signInWithPassword', 'signUp'] as const).flatMap((method) =>
    (['local', 'global', 'reset'] as const).map((scope) => ({ method, scope })),
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
    const boundClient = createClient(sessionProject, 'test-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, lock },
      global: { fetch: logoutFetch },
    });
    const otherTab = serializeAccountSignIns(
      createClient(sessionProject, 'test-key', {
        auth: { autoRefreshToken: false, detectSessionInUrl: false, lock },
        global: { fetch },
      }),
    );
    await Promise.all([boundClient.auth.initialize(), otherTab.auth.initialize()]);
    const originalSession = (await boundClient.auth.getSession()).data.session!;
    const signIn = otherTab.auth[method]({
      email: 'replacement@example.com',
      password: 'password',
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    requested.mockClear();
    const cleanup =
      scope === 'reset'
        ? updateRecoveryPassword(boundClient, originalSession, 'new-password')
        : signOutPasswordSession(boundClient, originalSession, scope);
    const rejected = expect(cleanup).rejects.toMatchObject({ code: 'sessionChanged' });
    await vi.waitFor(() => expect(requested).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe(account().id);
    release();
    await signIn;
    await rejected;
    expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('replacement');
    expect((await otherTab.auth.getSession()).data.session?.user.id).toBe('replacement');
    expect(logoutFetch).not.toHaveBeenCalled();
    await Promise.all([boundClient.auth.stopAutoRefresh(), otherTab.auth.stopAutoRefresh()]);
  },
);

it.each(['local', 'global', 'reset'] as const)(
  'preserves a new session for the same account during %s password completion',
  async (scope) => {
    const { client, auth, key } = storedClient();
    const original = (await auth.getSession()).data.session;
    const replacement = {
      ...original,
      access_token: `header.${btoa(JSON.stringify({ session_id: 'replacement-session' }))}.signature`,
    };
    localStorage.setItem(key, JSON.stringify(replacement));
    await expect(
      scope === 'reset'
        ? updateRecoveryPassword(client, original, 'new-password')
        : signOutPasswordSession(client, original, scope),
    ).rejects.toMatchObject({
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
  const boundClient = createClient(sessionProject, 'test-key', {
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
  await Promise.all([boundClient.auth.initialize(), otherTab.auth.initialize()]);
  const cleanup = signOutPasswordSession(
    boundClient,
    (await boundClient.auth.getSession()).data.session!,
    'local',
  );
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
  await Promise.all([boundClient.auth.stopAutoRefresh(), otherTab.auth.stopAutoRefresh()]);
});

it.each(['local', 'global', 'reset'] as const)(
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
      scope === 'reset'
        ? updateRecoveryPassword(client, session, 'new-password')
        : signOutPasswordSession(client, session, scope),
    ).rejects.toMatchObject({
      code: scope === 'global' ? 'sessionRevocation' : 'auth',
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

it('holds the auth lock through the recovery password update before another client can sign in', async () => {
  const sessionProject = 'https://recovery-update-race.supabase.co';
  const { key } = storedClient(sessionProject);
  const replacement = {
    ...JSON.parse(localStorage.getItem(key)!),
    expires_in: 3600,
    user: account('replacement'),
  };
  let release!: () => void;
  const updateFetch = vi.fn<(url: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
    () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ user: account() })));
      }),
  );
  const recovery = createClient(sessionProject, 'test-key', {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, lock: processLock },
    global: { fetch: updateFetch },
  });
  const signInFetch = vi.fn(async () => new Response(JSON.stringify(replacement)));
  const otherTab = serializeAccountSignIns(
    createClient(sessionProject, 'test-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, lock: processLock },
      global: { fetch: signInFetch },
    }),
  );
  await Promise.all([recovery.auth.initialize(), otherTab.auth.initialize()]);
  const session = (await recovery.auth.getSession()).data.session!;
  const updating = updateRecoveryPassword(recovery, session, 'new-password');
  await vi.waitFor(() => expect(updateFetch).toHaveBeenCalledTimes(1));
  expect(updateFetch.mock.calls[0][1]).toMatchObject({
    method: 'PUT',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  expect(JSON.parse(updateFetch.mock.calls[0][1]!.body as string)).toMatchObject({
    password: 'new-password',
  });
  const signingIn = otherTab.auth.signInWithPassword({
    email: 'replacement@example.com',
    password: 'password',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(signInFetch).not.toHaveBeenCalled();
  release();
  await updating;
  await signingIn;
  expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe('replacement');
  await Promise.all([recovery.auth.stopAutoRefresh(), otherTab.auth.stopAutoRefresh()]);
});

it('rejects a missing recovery session before calling the password update primitive', async () => {
  const { client, auth, key } = storedClient();
  const session = (await auth.getSession()).data.session;
  localStorage.removeItem(key);
  const updateUser = vi.spyOn(
    client.auth as unknown as { _updateUser: typeof client.auth.updateUser },
    '_updateUser',
  );
  await expect(updateRecoveryPassword(client, session, 'new-password')).rejects.toMatchObject({
    code: 'recoveryInvalid',
  });
  expect(updateUser).not.toHaveBeenCalled();
});

it('translates a provider password rejection while preserving the recovery session', async () => {
  const sessionProject = 'https://recovery-weak-password.supabase.co';
  const { key } = storedClient(sessionProject);
  const client = createClient(sessionProject, 'test-key', {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, lock: processLock },
    global: {
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'weak_password', msg: 'Password rejected' }), {
            status: 422,
            headers: { 'X-Supabase-Api-Version': '2024-01-01' },
          }),
      ),
    },
  });
  const session = (await client.auth.getSession()).data.session!;
  await expect(updateRecoveryPassword(client, session, 'weak-password')).rejects.toMatchObject({
    code: 'weakPassword',
  });
  expect((await client.auth.getSession()).data.session?.user.id).toBe(session.user.id);
  expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe(session.user.id);
  await client.auth.stopAutoRefresh();
});

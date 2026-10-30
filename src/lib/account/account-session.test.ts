import { beforeEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  accountAuthOptions,
  accountAuthStorageKey,
  assertPasswordSignOutSupport,
  serializeAccountSignIns,
  signOutPasswordSession,
  updateRecoveryPassword,
} from './account-session';
import { account } from '../../test/fake-supabase';
import { fakeLocks } from '../../test/fake-locks';

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
    initialize: vi.fn(async () => ({ error: null })),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    updateUser: vi.fn(async () => ({ data: { user: account() }, error: null })),
    signOut: vi.fn<(options?: { scope: 'local' }) => Promise<{ error: Error | null }>>(
      async () => ({ error: null }),
    ),
    getSession: vi.fn(async () => ({
      data: { session: JSON.parse(localStorage.getItem(key) ?? 'null') },
      error: null,
    })),
  };
  const client = serializeAccountSignIns({ auth } as unknown as SupabaseClient, projectUrl);
  return { auth, key, client };
}

it('preserves the SDK’s existing storage key and can load its persisted session before cleanup', async () => {
  const existingProject = 'https://existing-session.supabase.co';
  const { key } = storedClient(existingProject);
  const existing = serializeAccountSignIns(
    createClient(existingProject, 'test-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: vi.fn(
          async () => new Response(JSON.stringify({ message: 'Session expired' }), { status: 404 }),
        ),
      },
    }),
    existingProject,
  );
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
    const { request: requested } = fakeLocks();
    const logoutFetch = vi.fn();
    const boundClient = serializeAccountSignIns(
      createClient(sessionProject, 'test-key', {
        auth: { autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: logoutFetch },
      }),
      sessionProject,
    );
    const otherTab = serializeAccountSignIns(
      createClient(sessionProject, 'test-key', {
        auth: { autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch },
      }),
      sessionProject,
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
  serializeAccountSignIns(boundClient, sessionProject);
  const fetch = vi.fn(async () => new Response(JSON.stringify(replacement)));
  const otherTab = serializeAccountSignIns(
    createClient(sessionProject, 'test-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch },
    }),
    sessionProject,
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
  'fails closed for %s cleanup when the client has no account lock',
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
  const recovery = serializeAccountSignIns(
    createClient(sessionProject, 'test-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: updateFetch },
    }),
    sessionProject,
  );
  const signInFetch = vi.fn(async () => new Response(JSON.stringify(replacement)));
  const otherTab = serializeAccountSignIns(
    createClient(sessionProject, 'test-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: signInFetch },
    }),
    sessionProject,
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
  await expect(updateRecoveryPassword(client, session, 'new-password')).rejects.toMatchObject({
    code: 'recoveryInvalid',
  });
  expect(auth.updateUser).not.toHaveBeenCalled();
});

it('translates a provider password rejection while preserving the recovery session', async () => {
  const sessionProject = 'https://recovery-weak-password.supabase.co';
  const { key } = storedClient(sessionProject);
  const client = serializeAccountSignIns(
    createClient(sessionProject, 'test-key', {
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: vi.fn(
          async () =>
            new Response(JSON.stringify({ code: 'weak_password', msg: 'Password rejected' }), {
              status: 422,
              headers: { 'X-Supabase-Api-Version': '2024-01-01' },
            }),
        ),
      },
    }),
    sessionProject,
  );
  const session = (await client.auth.getSession()).data.session!;
  await expect(updateRecoveryPassword(client, session, 'weak-password')).rejects.toMatchObject({
    code: 'weakPassword',
  });
  expect((await client.auth.getSession()).data.session?.user.id).toBe(session.user.id);
  expect(JSON.parse(localStorage.getItem(key)!).user.id).toBe(session.user.id);
  await client.auth.stopAutoRefresh();
});

it.each(['auth', 'sessionRevocation'] as const)(
  'reports %s for password changes only when the client has no account lock',
  async (code) => {
    const { client } = storedClient();
    expect(() => assertPasswordSignOutSupport(client, code)).not.toThrow();
    const unregistered = { auth: {} } as unknown as SupabaseClient;
    expect(() => assertPasswordSignOutSupport(unregistered, code)).toThrow(
      expect.objectContaining({ code }),
    );
  },
);

it('initializes the session under the account lock', async () => {
  const sessionProject = 'https://initialize-lock.supabase.co';
  storedClient(sessionProject);
  const held = fakeLocks().hold('garage-guardian:account:');
  const client = serializeAccountSignIns(
    createClient(sessionProject, 'test-key', {
      auth: { ...accountAuthOptions(sessionProject), autoRefreshToken: false },
      global: { fetch: vi.fn() },
    }),
    sessionProject,
  );
  let initialized = false;
  const initializing = client.auth.initialize().then(() => (initialized = true));
  await vi.waitFor(() => expect(held.requested).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(initialized).toBe(false);
  held.release();
  await initializing;
  expect((await client.auth.getSession()).data.session?.user.id).toBe(account().id);
  await client.auth.stopAutoRefresh();
});

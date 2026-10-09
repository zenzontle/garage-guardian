import { beforeEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { accountAuthStorageKey, clearDeletedAccountSession } from './account-session';
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
    signOut: vi.fn(async () => ({ error: null as Error | null })),
    getSession: vi.fn(async () => ({
      data: { session: JSON.parse(localStorage.getItem(key) ?? 'null') },
      error: null,
    })),
  };
  return { auth, key, client: { auth } as unknown as SupabaseClient };
}

it('preserves the SDK’s existing storage key and can load its persisted session before cleanup', async () => {
  const existingProject = 'https://existing-session.supabase.co';
  const { key } = storedClient(existingProject);
  const existing = createClient(existingProject, 'test-key', {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
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

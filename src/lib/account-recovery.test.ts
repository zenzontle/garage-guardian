import { beforeEach, expect, it, vi } from 'vitest';
import { clearRecovery, rememberRecovery, storedRecovery } from './account-recovery';
import { account, fakeSupabase } from '../test/fake-supabase';

const project = 'https://recovery.supabase.co';
const key = `garage-guardian:recovery:${project}`;
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', project);
  localStorage.clear();
  sessionStorage.clear();
});

it('keeps the recovery binding and revocation retry across a closed tab without storing credentials', async () => {
  const cloud = fakeSupabase();
  cloud.emit(account());
  const session = (await cloud.auth.getSession()).data.session!;
  rememberRecovery(session, true);
  const marker = localStorage.getItem(key)!;
  expect(marker).not.toContain(session.access_token);
  expect(marker).not.toContain(session.refresh_token);
  sessionStorage.clear();
  vi.resetModules();
  const newTab = await import('./account-recovery');
  expect(newTab.storedRecovery(session)).toEqual({ finishing: true });
  cloud.newSession();
  expect(newTab.storedRecovery((await cloud.auth.getSession()).data.session!)).toBeNull();
  newTab.clearRecovery();
  expect(localStorage.getItem(key)).toBeNull();
});

it('migrates a matching tab-only marker and clears both stores on cancellation', async () => {
  const cloud = fakeSupabase();
  cloud.emit(account());
  const session = (await cloud.auth.getSession()).data.session!;
  rememberRecovery(session, true);
  sessionStorage.setItem(key, localStorage.getItem(key)!);
  localStorage.removeItem(key);
  expect(storedRecovery(session)).toEqual({ finishing: true });
  expect(localStorage.getItem(key)).not.toBeNull();
  expect(sessionStorage.getItem(key)).toBeNull();
  sessionStorage.setItem(key, 'legacy marker');
  clearRecovery();
  expect(localStorage.getItem(key)).toBeNull();
  expect(sessionStorage.getItem(key)).toBeNull();
});

it('rejects malformed markers and tokens without a session binding', async () => {
  const cloud = fakeSupabase();
  cloud.emit(account());
  const session = (await cloud.auth.getSession()).data.session!;
  localStorage.setItem(key, '{');
  expect(storedRecovery(session)).toBeNull();
  localStorage.setItem(key, JSON.stringify({ id: null, finishing: true }));
  expect(storedRecovery({ ...session, access_token: 'invalid' })).toBeNull();
});

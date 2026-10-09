import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { account, fakeSupabase } from '../test/fake-supabase';
import { car, schedule, visit } from '../test/fixtures';

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const { navigatorLock } = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { createClient: vi.fn(), navigatorLock };
});
const project = 'https://garage.supabase.co';
let cloud: ReturnType<typeof fakeSupabase>;

beforeEach(async () => {
  await clear();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.resetModules();
  vi.doMock('react', () => React);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', project);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
  cloud = fakeSupabase();
  vi.mocked(createClient).mockReturnValue(
    cloud.client as unknown as ReturnType<typeof createClient>,
  );
});

it('updates same-ID user metadata without rebuilding the repository', async () => {
  cloud.emit(account());
  const hook = await openGarage();
  const repository = hook.result.current.repository;
  const calls = cloud.from.mock.calls.length;
  act(() => cloud.emit({ ...account(), email: 'confirmed@example.com' }, 'USER_UPDATED'));
  expect(hook.result.current.user?.email).toBe('confirmed@example.com');
  expect(hook.result.current.repository).toBe(repository);
  expect(cloud.from.mock.calls.length).toBe(calls);
});

it('suspends signup transfer during recovery after closing the tab and resumes after ordinary sign-in', async () => {
  const { LocalRepository } = await import('./repository');
  const { registerSignup } = await import('./signup-transfer');
  await new LocalRepository().saveCar(car);
  await registerSignup(project, account(), true);
  const hook = await openGarage();
  window.history.replaceState(
    null,
    '',
    '/auth/recovery#access_token=secret&refresh_token=secret&type=recovery',
  );
  act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
  expect(hook.result.current.recovering).toBe(true);
  expect(hook.result.current.repository).toBeNull();
  expect(window.location.hash).toBe('');
  expect(localStorage.getItem(`garage-guardian:recovery:${project}`)).not.toContain('secret');
  hook.unmount();
  sessionStorage.clear(); // Closing a tab clears its storage, but Auth remains persisted.
  vi.resetModules();
  const reopened = await openGarage();
  expect(reopened.result.current.recovering).toBe(true);
  expect(cloud.from).not.toHaveBeenCalled();
  expect((await new LocalRepository().load()).cars).toEqual([car]);
  await act(async () => reopened.result.current.signIn('owner@example.com', 'password'));
  await waitFor(() => expect(reopened.result.current.repository).not.toBeNull());
  expect(reopened.result.current.snapshot.cars).toEqual([car]);
  expect(localStorage.getItem(`garage-guardian:recovery:${project}`)).toBeNull();
});

it('requires a recovery event or a marker bound to this session, not just the recovery URL', async () => {
  cloud.emit(account());
  window.history.replaceState(
    null,
    '',
    '/auth/recovery?error=access_denied&error_code=otp_expired',
  );
  const hook = await openGarage();
  expect(hook.result.current.recovering).toBe(false);
  expect(window.location.search).toBe('');
  act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
  hook.unmount();
  cloud.newSession();
  const reopened = await openGarage();
  expect(reopened.result.current.recovering).toBe(false);
});

it('clears recovery on identity change and rejects password mismatch before updating', async () => {
  const hook = await openGarage();
  act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
  await act(async () => {
    await expect(hook.result.current.resetPassword('abcdef', 'different')).rejects.toMatchObject({
      code: 'passwordMismatch',
    });
  });
  expect(cloud.auth.updateUser).not.toHaveBeenCalled();
  act(() => cloud.emit(account('another')));
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.recovering).toBe(false);
  expect(localStorage.getItem(`garage-guardian:recovery:${project}`)).toBeNull();
});

it('resets the recovery password, revokes refresh sessions, and clears the local account', async () => {
  const hook = await openGarage();
  act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
  await act(async () => hook.result.current.resetPassword('new-password', 'new-password'));
  expect(cloud.auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' });
  expect(cloud.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
  expect(hook.result.current.user).toBeNull();
  expect(hook.result.current.accountNotice).toBe('passwordChanged');
  expect(hook.result.current.recovering).toBe(false);
});

it('uses browser recovery/resend with fixed same-origin redirects and a shared 60-second cooldown', async () => {
  const hook = await openGarage();
  await act(async () => hook.result.current.requestRecovery('owner@example.com'));
  expect(cloud.auth.resetPasswordForEmail).toHaveBeenCalledWith('owner@example.com', {
    redirectTo: `${window.location.origin}/auth/recovery`,
  });
  await act(async () => hook.result.current.resendConfirmation('owner@example.com'));
  expect(cloud.auth.resend).toHaveBeenCalledWith({
    type: 'signup',
    email: 'owner@example.com',
    options: { emailRedirectTo: `${window.location.origin}/` },
  });
  await act(async () => {
    await expect(
      hook.result.current.resendConfirmation('different@example.com'),
    ).rejects.toMatchObject({ code: 'resendCooldown' });
  });
  expect(cloud.auth.resend).toHaveBeenCalledTimes(1);
});

it('refreshes pending email metadata without replacing the current address or repository', async () => {
  cloud.emit(account());
  const hook = await openGarage();
  const repository = hook.result.current.repository;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
  cloud.auth.getUser.mockResolvedValueOnce({
    data: { user: { ...account(), new_email: 'pending@example.com' } },
    error: null,
  });
  await act(async () => hook.result.current.changeEmail('current-password', 'pending@example.com'));
  expect(hook.result.current.user?.email).toBe(account().email);
  expect(hook.result.current.user?.new_email).toBe('pending@example.com');
  expect(hook.result.current.repository).toBe(repository);
});

it('blocks account mutations during a failed signup transfer', async () => {
  const hook = await openGarage();
  cloud.execute.mockResolvedValueOnce({ data: null, error: new Error('Offline') });
  const { LocalRepository } = await import('./repository');
  await new LocalRepository().saveCar(car);
  await act(async () => hook.result.current.signUp('new@example.com', 'password'));
  await waitFor(() => expect(hook.result.current.error?.code).toBe('transfer'));
  await act(async () => {
    await expect(
      hook.result.current.changeEmail('password', 'new@example.com'),
    ).rejects.toMatchObject({ code: 'operationBusy' });
  });
});

it('waits for existing work during deletion, pauses new writes, and preserves guest records/photos', async () => {
  const { LocalRepository } = await import('./repository');
  const local = new LocalRepository();
  await local.saveCar(car);
  const photo = await local.uploadPhoto(
    visit.id,
    new File(['guest'], 'guest.webp', { type: 'image/webp' }),
  );
  await local.saveVisit({ ...visit, photos: [photo] });
  cloud.emit(account());
  const hook = await openGarage();
  const repository = hook.result.current.repository!;
  const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let work!: Promise<unknown>;
  act(() => {
    work = hook.result.current.run(() => delayed);
  });
  let deletion!: Promise<void>;
  act(() => {
    deletion = hook.result.current.deleteAccount('password', true);
  });
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    repository.uploadPhoto(visit.id, new File(['blocked'], 'blocked.webp')),
  ).rejects.toMatchObject({ code: 'operationBusy' });
  await act(async () => {
    release();
    await work;
    await deletion;
  });
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.accountNotice).toBe('deleted');
  expect(hook.result.current.user).toBeNull();
  expect(hook.result.current.snapshot.cars).toEqual([car]);
  expect((await local.readPhoto(photo)).size).toBe(5);
});

it('does not claim deletion or discard guest data after a failed/lost response', async () => {
  cloud.emit(account());
  const hook = await openGarage();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Lost response');
    }),
  );
  await act(async () => {
    await expect(hook.result.current.deleteAccount('password', true)).rejects.toThrow(
      'Lost response',
    );
  });
  expect(hook.result.current.user?.id).toBe(account().id);
  expect(hook.result.current.accountNotice).toBeNull();
  expect(hook.result.current.accountBusy).toBe(false);
  expect(
    localStorage.getItem(`garage-guardian:deleted-transfer:v1:${project}:${account().id}`),
  ).toBeNull();
});

it('clears retained sign-in credentials after confirmed deletion and a failed local sign-out', async () => {
  const { accountAuthStorageKey } = await import('./account-session');
  const key = accountAuthStorageKey(project);
  const { LocalRepository } = await import('./repository');
  await new LocalRepository().saveCar(car);
  cloud.emit(account());
  const hook = await openGarage();
  const session = (await cloud.auth.getSession()).data.session;
  localStorage.setItem(key, JSON.stringify(session));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  );
  cloud.auth.signOut.mockResolvedValueOnce({ error: new Error('Offline') });
  await act(async () => hook.result.current.deleteAccount('password', true));
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(localStorage.getItem(key)).toBeNull();
  expect(hook.result.current.user).toBeNull();
  expect(hook.result.current.accountNotice).toBe('deleted');
  expect(hook.result.current.snapshot.cars).toEqual([car]);
  hook.unmount();
  const reopened = await openGarage();
  expect(reopened.result.current.user).toBeNull();
  expect(reopened.result.current.snapshot.cars).toEqual([car]);
});

it('withholds the deletion success notice if persisted sign-in cleanup fails', async () => {
  const { accountAuthStorageKey } = await import('./account-session');
  const key = accountAuthStorageKey(project);
  cloud.emit(account());
  const hook = await openGarage();
  localStorage.setItem(key, JSON.stringify((await cloud.auth.getSession()).data.session));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  );
  cloud.auth.signOut.mockResolvedValueOnce({ error: new Error('Offline') });
  const removeItem = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, name) {
    if (name === key) throw new Error('Storage unavailable');
    removeItem.call(this, name);
  });
  await act(async () => {
    await expect(hook.result.current.deleteAccount('password', true)).rejects.toMatchObject({
      code: 'accountDeletionSessionCleanup',
    });
  });
  expect(hook.result.current.accountNotice).toBeNull();
  expect(hook.result.current.accountBusy).toBe(false);
});

it('retries a deleted account’s marker cleanup after reload without blocking new signup', async () => {
  const { LocalRepository } = await import('./repository');
  const local = new LocalRepository();
  await local.saveCar(car);
  cloud.emit(account());
  const hook = await openGarage();
  const transfer = await import('./signup-transfer');
  const cleanup = vi
    .spyOn(transfer, 'clearAccountTransfer')
    .mockRejectedValueOnce(new Error('IndexedDB unavailable'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      // Model a stale marker left by an older tab after deletion was requested.
      const { set } = await import('idb-keyval');
      await set(`garage-guardian:signup-transfer:v1:${project}`, {
        userId: account().id,
        status: 'pending',
      });
      return new Response('{}');
    }),
  );
  await act(async () => hook.result.current.deleteAccount('password', true));
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(cleanup).toHaveBeenCalledWith(project, account().id);
  expect(cloud.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(hook.result.current.user).toBeNull();
  expect(hook.result.current.snapshot.cars).toEqual([car]);
  expect(hook.result.current.accountNotice).toBe('deleted');
  expect(hook.result.current.accountBusy).toBe(false);
  cleanup.mockRestore();
  hook.unmount();
  vi.resetModules();
  const reopened = await openGarage();
  cloud.requireConfirmation();
  await act(async () => {
    expect(await reopened.result.current.signUp('new@example.com', 'password')).toBe(true);
  });
  expect(cloud.auth.signUp).toHaveBeenCalledTimes(1);
  expect((await local.load()).cars).toEqual([car]);
});

function sharedTransferLock() {
  let tail = Promise.resolve();
  const request = vi.fn((_key: string, work: () => Promise<unknown>) => {
    const pending = tail.then(work);
    tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  });
  vi.stubGlobal('navigator', { locks: { request } });
  return request;
}

it('holds the transfer lock across signup’s auth event and marker registration', async () => {
  const { LocalRepository } = await import('./repository');
  const { withSignupTransferLock, pendingTransfer } = await import('./signup-transfer');
  await new LocalRepository().saveCar(car);
  const signupTab = await openGarage();
  const otherTab = await openGarage();
  sharedTransferLock();
  const signUp = cloud.auth.signUp.getMockImplementation()!;
  let release!: () => void;
  const competingDeletion = vi.fn(async () => {
    expect((await pendingTransfer(project))?.userId).toBe(account().id);
  });
  let competingWork!: Promise<void>;
  cloud.auth.signUp.mockImplementationOnce(async () => {
    const result = await signUp(); // SIGNED_IN reaches both tabs before the response.
    competingWork = withSignupTransferLock(project, competingDeletion);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return result;
  });
  let signingUp!: Promise<boolean>;
  act(() => {
    signingUp = signupTab.result.current.signUp('new@example.com', 'password');
  });
  await waitFor(() => expect(release).toBeTypeOf('function'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(competingDeletion).not.toHaveBeenCalled();
  expect(otherTab.result.current.repository).toBeNull();
  expect((await new LocalRepository().load()).cars).toEqual([car]);
  await act(async () => {
    release();
    await signingUp;
    await competingWork;
  });
  await waitFor(() => expect(otherTab.result.current.repository).not.toBeNull());
  expect(otherTab.result.current.snapshot.cars).toEqual([car]);
});

it('waits for another tab’s signup registration and rejects deletion once its marker appears', async () => {
  const { LocalRepository } = await import('./repository');
  const { registerSignup } = await import('./signup-transfer');
  await new LocalRepository().saveCar(car);
  cloud.emit(account());
  const hook = await openGarage();
  const request = sharedTransferLock();
  let release!: () => void;
  const registration = request(`garage-guardian:signup-transfer:v1:${project}`, async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await registerSignup(project, account(), true);
  });
  await waitFor(() => expect(release).toBeTypeOf('function'));
  const fetch = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  let deleting!: Promise<void>;
  act(() => {
    deleting = hook.result.current.deleteAccount('password', true);
  });
  const rejected = expect(deleting).rejects.toMatchObject({ code: 'operationBusy' });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => {
    release();
    await registration;
    await rejected;
  });
  expect(fetch).not.toHaveBeenCalled();
  expect((await new LocalRepository().load()).cars).toEqual([car]);
  expect(hook.result.current.accountBusy).toBe(false);
});

it('drains another tab’s verified transfer before deleting, preserving unrelated guest records and photos', async () => {
  const { LocalRepository } = await import('./repository');
  const { registerSignup } = await import('./signup-transfer');
  const local = new LocalRepository();
  await local.saveCar(car);
  cloud.emit(account());
  const hook = await openGarage();
  sharedTransferLock();
  await registerSignup(project, account(), true);
  // A separate module queue models another tab; only Web Locks coordinate it.
  vi.resetModules();
  const { transferSignupData } = await import('./signup-transfer');
  const { LocalRepository: OtherLocalRepository } = await import('./repository');
  const clearTransferred = OtherLocalRepository.prototype.clearTransferred;
  let release!: () => void;
  let cleared = false;
  vi.spyOn(OtherLocalRepository.prototype, 'clearTransferred').mockImplementationOnce(
    async function (this: InstanceType<typeof OtherLocalRepository>, snapshot) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await clearTransferred.call(this, snapshot);
      cleared = true;
    },
  );
  const transferring = transferSignupData(cloud.client, project, account().id);
  await waitFor(() => expect(release).toBeTypeOf('function'));
  const guestCar = { ...car, id: '55555555-5555-4555-8555-555555555555' };
  await local.saveCar(guestCar);
  const photo = await local.uploadPhoto(visit.id, new File(['guest'], 'guest.webp'));
  const guestVisit = { ...visit, carId: guestCar.id, photos: [photo] };
  await local.saveVisit(guestVisit);
  const fetch = vi.fn(async () => {
    expect(cleared).toBe(true);
    return new Response('{}');
  });
  vi.stubGlobal('fetch', fetch);
  let deleting!: Promise<void>;
  act(() => {
    deleting = hook.result.current.deleteAccount('password', true);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(fetch).not.toHaveBeenCalled();
  expect((await local.load()).cars).toContainEqual(car);
  await act(async () => {
    release();
    await transferring;
    await deleting;
  });
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(hook.result.current.snapshot.cars).toEqual([guestCar]);
  expect(hook.result.current.snapshot.visits).toEqual([guestVisit]);
  expect(await local.readPhoto(photo)).toBeInstanceOf(Blob);
  expect(hook.result.current.accountNotice).toBe('deleted');
});

it.each(['password', 'delete'] as const)(
  'clears the %s success notice after sign-in but retains it after failed sign-in',
  async (kind) => {
    cloud.emit(account());
    const hook = await openGarage();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}')),
    );
    await act(async () =>
      kind === 'password'
        ? hook.result.current.changePassword('password', 'new-password', 'new-password')
        : hook.result.current.deleteAccount('password', true),
    );
    const notice = kind === 'password' ? 'passwordChanged' : 'deleted';
    expect(hook.result.current.accountNotice).toBe(notice);
    cloud.auth.signInWithPassword.mockRejectedValueOnce(new Error('Incorrect password'));
    await act(async () => {
      await expect(hook.result.current.signIn('owner@example.com', 'wrong')).rejects.toThrow(
        'Incorrect password',
      );
    });
    expect(hook.result.current.accountNotice).toBe(notice);
    await act(async () => hook.result.current.signIn('owner@example.com', 'new-password'));
    expect(hook.result.current.accountNotice).toBeNull();
  },
);

it('clears an account notice when a different account signs in through an auth event', async () => {
  cloud.emit(account());
  const hook = await openGarage();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  );
  await act(async () => hook.result.current.deleteAccount('password', true));
  expect(hook.result.current.accountNotice).toBe('deleted');
  act(() => cloud.emit(account('replacement'), 'SIGNED_IN'));
  expect(hook.result.current.user?.id).toBe('replacement');
  expect(hook.result.current.accountNotice).toBeNull();
});

it('clears recovery on cancellation and on a new session for the same account', async () => {
  const hook = await openGarage();
  act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
  await act(async () => hook.result.current.signOut());
  expect(hook.result.current.recovering).toBe(false);
  expect(localStorage.getItem(`garage-guardian:recovery:${project}`)).toBeNull();
  act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
  cloud.newSession();
  act(() => cloud.emit(account()));
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.recovering).toBe(false);
});

it.each(['?', '#'])(
  'keeps an existing recovery session restricted after a %s callback error',
  async (separator) => {
    const { LocalRepository } = await import('./repository');
    const { registerSignup, pendingTransfer } = await import('./signup-transfer');
    await new LocalRepository().saveCar(car);
    await registerSignup(project, account(), true);
    const hook = await openGarage();
    act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
    const marker = localStorage.getItem(`garage-guardian:recovery:${project}`);
    hook.unmount();
    window.history.replaceState(
      null,
      '',
      `/auth/recovery${separator}error=access_denied&error_code=otp_expired`,
    );
    const reopened = await openGarage();
    expect(reopened.result.current.recovering).toBe(true);
    expect(reopened.result.current.repository).toBeNull();
    expect(cloud.from).not.toHaveBeenCalled();
    expect((await new LocalRepository().load()).cars).toEqual([car]);
    expect((await pendingTransfer(project))?.userId).toBe(account().id);
    expect(localStorage.getItem(`garage-guardian:recovery:${project}`)).toBe(marker);
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('');
  },
);

it('retries failed recovery revocation after closing the tab without repeating the password update', async () => {
  const hook = await openGarage();
  act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
  cloud.auth.signOut.mockRejectedValueOnce(new Error('Network unavailable'));
  await act(async () => {
    await expect(
      hook.result.current.resetPassword('new-password', 'new-password'),
    ).rejects.toMatchObject({ code: 'sessionRevocation' });
  });
  hook.unmount();
  sessionStorage.clear();
  vi.resetModules();
  const reopened = await openGarage();
  expect(reopened.result.current.recovering).toBe(true);
  await act(async () => reopened.result.current.resetPassword('new-password', 'new-password'));
  expect(cloud.auth.updateUser).toHaveBeenCalledTimes(1);
  expect(reopened.result.current.accountNotice).toBe('passwordChanged');
  expect(localStorage.getItem(`garage-guardian:recovery:${project}`)).toBeNull();
});

it.each(['password', 'recovery'] as const)(
  'does not sign out a replacement account while %s completion waits for the auth lock',
  async (kind) => {
    cloud.emit(account());
    const hook = await openGarage();
    if (kind === 'recovery') act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}')),
    );
    let release!: () => void;
    cloud.auth._acquireLock.mockImplementationOnce(async (_timeout, work) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return work();
    });
    let work!: Promise<void>;
    act(() => {
      work =
        kind === 'password'
          ? hook.result.current.changePassword('password', 'new-password', 'new-password')
          : hook.result.current.resetPassword('new-password', 'new-password');
    });
    const outcome = work.catch((error: unknown) => error);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    act(() => cloud.emit(account('replacement')));
    await act(async () => {
      release();
      expect(await outcome).toMatchObject({ code: 'sessionChanged' });
    });
    expect(cloud.auth.signOut).not.toHaveBeenCalled();
    expect(hook.result.current.user?.id).toBe('replacement');
    expect(hook.result.current.accountNotice).toBeNull();
  },
);

it('does not revoke a replacement account after a password request finishes under an old identity', async () => {
  cloud.emit(account());
  const hook = await openGarage();
  let release!: () => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response('{}'));
        }),
    ),
  );
  let work!: Promise<void>;
  act(() => {
    work = hook.result.current.changePassword('password', 'new-password', 'new-password');
  });
  const canceled = expect(work).rejects.toMatchObject({ code: 'sessionChanged' });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  act(() => cloud.emit(account('replacement')));
  await act(async () => {
    release();
    await canceled;
  });
  expect(cloud.auth.signOut).not.toHaveBeenCalled();
  expect(hook.result.current.user?.id).toBe('replacement');
});

it('returns to sign-in after account password changes and retains another account’s transfer marker on deletion', async () => {
  cloud.emit(account());
  const hook = await openGarage();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  );
  cloud.auth.signOut.mockImplementationOnce(async () => {
    cloud.emit(null);
    return { error: new Error('Local logout response lost after credentials were cleared') };
  });
  await act(async () =>
    hook.result.current.changePassword('password', 'new-password', 'new-password'),
  );
  expect(cloud.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(hook.result.current.accountNotice).toBe('passwordChanged');
  expect(hook.result.current.user).toBeNull();
  const { registerSignup, pendingTransfer } = await import('./signup-transfer');
  await registerSignup(project, account('unrelated'), true);
  await act(async () => hook.result.current.signIn('owner@example.com', 'password'));
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  await act(async () => hook.result.current.deleteAccount('password', true));
  expect((await pendingTransfer(project))?.userId).toBe('unrelated');
});

async function openGarage() {
  const { useGarageSession } = await import('./use-garage-session');
  const hook = renderHook(() => useGarageSession());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

it('opens configured guests locally and restores guest data after ordinary sign-in and logout', async () => {
  const { LocalRepository } = await import('./repository');
  await new LocalRepository().saveCar(car);
  const hook = await openGarage();
  expect(hook.result.current.snapshot.cars).toEqual([car]);
  expect(cloud.from).not.toHaveBeenCalled();
  await act(async () => {
    await hook.result.current.signIn('owner@example.com', 'password');
  });
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.user?.id).toBe(account().id);
  expect(hook.result.current.snapshot.cars).toEqual([]);
  expect((await new LocalRepository().load()).cars).toEqual([car]);
  await act(async () => {
    await hook.result.current.run(() =>
      hook.result.current.repository!.saveCar({ ...car, id: 'cloud-car' }),
    );
  });
  expect((await new LocalRepository().load()).cars).toEqual([car]);
  await act(async () => {
    await hook.result.current.signOut();
  });
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.snapshot.cars).toEqual([car]);
});

it('moves guest data after immediate signup, then uses only cloud storage and logs out to a fresh garage', async () => {
  const { LocalRepository } = await import('./repository');
  const local = new LocalRepository();
  await local.saveCar(car);
  await local.saveSchedule(schedule);
  await local.saveVisit(visit);
  const hook = await openGarage();
  await act(async () => {
    expect(await hook.result.current.signUp('new@example.com', 'password')).toBe(false);
  });
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.snapshot.cars).toEqual([car]);
  expect(await local.load()).toEqual({ cars: [], schedules: [], visits: [] });
  await act(async () => {
    await hook.result.current.run(() =>
      hook.result.current.repository!.saveCar({ ...car, name: 'Cloud change' }),
    );
  });
  expect((await local.load()).cars).toEqual([]);
  expect(cloud.tables.get('cars')?.get(car.id)?.name).toBe('Cloud change');
  await act(async () => {
    await hook.result.current.signOut();
  });
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.snapshot.cars).toEqual([]);
});

it('keeps confirmation-pending signup local across reload and transfers after the matching account signs in', async () => {
  cloud.requireConfirmation();
  const { LocalRepository } = await import('./repository');
  const local = new LocalRepository();
  await local.saveCar(car);
  const hook = await openGarage();
  await act(async () => {
    expect(await hook.result.current.signUp('new@example.com', 'password')).toBe(true);
  });
  await act(async () => {
    await hook.result.current.run(() => hook.result.current.repository!.saveSchedule(schedule));
  });
  expect(cloud.from).not.toHaveBeenCalled();
  hook.unmount();
  const reopened = await openGarage();
  expect(reopened.result.current.user).toBeNull();
  expect(reopened.result.current.snapshot.schedules).toEqual([schedule]);
  await act(async () => {
    await reopened.result.current.signIn('new@example.com', 'password');
  });
  await waitFor(() => expect(reopened.result.current.repository).not.toBeNull());
  expect(reopened.result.current.snapshot.schedules).toEqual([schedule]);
  expect((await local.load()).cars).toEqual([]);
});

it('never transfers guest data for an existing-account signup response or a failed signup', async () => {
  const { LocalRepository } = await import('./repository');
  const { pendingTransfer } = await import('./signup-transfer');
  const local = new LocalRepository();
  await local.saveCar(car);
  const hook = await openGarage();
  cloud.auth.signUp.mockRejectedValueOnce(new Error('Signup disabled'));
  await act(async () => {
    await expect(hook.result.current.signUp('new@example.com', 'password')).rejects.toThrow(
      'Signup disabled',
    );
  });
  expect(await pendingTransfer(project)).toBeUndefined();
  cloud.existingSignup();
  await act(async () => {
    expect(await hook.result.current.signUp('existing@example.com', 'password')).toBe(true);
  });
  expect(await pendingTransfer(project)).toBeUndefined();
  await act(async () => {
    await hook.result.current.signIn('existing@example.com', 'password');
  });
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.snapshot.cars).toEqual([]);
  expect((await local.load()).cars).toEqual([car]);
});

it('leaves failed transfers blocked for retry and resumes after reload', async () => {
  const { LocalRepository } = await import('./repository');
  const local = new LocalRepository();
  await local.saveCar(car);
  const photo = await local.uploadPhoto(
    visit.id,
    new File(['receipt'], 'receipt.webp', { type: 'image/webp' }),
  );
  await local.saveVisit({ ...visit, photos: [photo] });
  const hook = await openGarage();
  cloud.bucket.upload.mockResolvedValueOnce({ error: new Error('Network unavailable') });
  await act(async () => {
    await hook.result.current.signUp('new@example.com', 'password');
  });
  await waitFor(() => expect(hook.result.current.error).toEqual({ code: 'transfer' }));
  expect(hook.result.current.repository).toBeNull();
  expect(hook.result.current.user?.id).toBe(account().id);
  expect((await local.load()).visits).toHaveLength(1);
  hook.unmount();
  const reopened = await openGarage();
  expect(reopened.result.current.repository).not.toBeNull();
  expect(reopened.result.current.snapshot.visits).toHaveLength(1);
  expect((await local.load()).visits).toEqual([]);
});

it('does not reload or reimport data on duplicate sign-in and token refresh events', async () => {
  cloud.emit(account());
  const hook = await openGarage();
  const calls = cloud.from.mock.calls.length;
  act(() => {
    cloud.emit(account());
    cloud.emit(account(), 'TOKEN_REFRESHED');
  });
  expect(hook.result.current.loading).toBe(false);
  expect(cloud.from.mock.calls.length).toBe(calls);
});

it('does not write or transfer for a different account while signup confirmation is pending', async () => {
  cloud.requireConfirmation();
  const { LocalRepository } = await import('./repository');
  const { pendingTransfer } = await import('./signup-transfer');
  const local = new LocalRepository();
  await local.saveCar(car);
  const hook = await openGarage();
  await act(async () => {
    await hook.result.current.signUp('new@example.com', 'password');
  });
  act(() => cloud.emit(account('different')));
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.snapshot.cars).toEqual([]);
  expect((await local.load()).cars).toEqual([car]);
  expect((await pendingTransfer(project))?.userId).toBe(account().id);
  expect(cloud.execute.mock.calls.some(([, operation]) => operation === 'upsert')).toBe(false);
});

it('cancels an in-flight transfer after logout and leaves guest data usable', async () => {
  const { LocalRepository } = await import('./repository');
  const local = new LocalRepository();
  await local.saveCar(car);
  const photo = await local.uploadPhoto(
    visit.id,
    new File(['receipt'], 'receipt.webp', { type: 'image/webp' }),
  );
  await local.saveVisit({ ...visit, photos: [photo] });
  const hook = await openGarage();
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  cloud.bucket.upload.mockImplementationOnce(async () => {
    await delayed;
    return { error: null };
  });
  await act(async () => {
    await hook.result.current.signUp('new@example.com', 'password');
  });
  await waitFor(() => expect(cloud.bucket.upload).toHaveBeenCalled());
  await act(async () => {
    await hook.result.current.signOut();
  });
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  await act(async () => {
    release();
    await delayed;
  });
  expect(hook.result.current.user).toBeNull();
  expect(hook.result.current.snapshot.cars).toEqual([car]);
  expect(cloud.bucket.download).not.toHaveBeenCalled();
  expect(cloud.tables.get('visits')?.size ?? 0).toBe(0);
});

it('ignores a stale cloud load after logout', async () => {
  const { LocalRepository } = await import('./repository');
  await new LocalRepository().saveCar(car);
  cloud.emit(account());
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  cloud.execute.mockImplementationOnce(async () => {
    await delayed;
    return { data: [], error: null };
  });
  const { useGarageSession } = await import('./use-garage-session');
  const hook = renderHook(() => useGarageSession());
  await waitFor(() => expect(cloud.execute).toHaveBeenCalled());
  act(() => cloud.emit(null));
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  await act(async () => {
    release();
    await delayed;
  });
  expect(hook.result.current.user).toBeNull();
  expect(hook.result.current.snapshot.cars).toEqual([car]);
});

it('ignores stale results and rejects old repository methods after switching accounts', async () => {
  cloud.emit(account());
  const hook = await openGarage();
  const previous = hook.result.current.repository!;
  const next = account('55555555-5555-4555-8555-555555555555');
  act(() => cloud.emit(next));
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.user?.id).toBe(next.id);
  await expect(previous.saveCar(car)).rejects.toThrow('session changed');
  expect(cloud.tables.get('cars')?.size ?? 0).toBe(0);
});

it('waits for an in-flight guest write before taking the signup transfer snapshot', async () => {
  const { LocalRepository } = await import('./repository');
  const { registerSignup } = await import('./signup-transfer');
  const hook = await openGarage();
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = LocalRepository.prototype.saveCar;
  vi.spyOn(LocalRepository.prototype, 'saveCar').mockImplementationOnce(async function (
    this: InstanceType<typeof LocalRepository>,
    value,
  ) {
    await delayed;
    return original.call(this, value);
  });
  let write!: Promise<{ refreshed: boolean }>;
  act(() => {
    write = hook.result.current.run(() => hook.result.current.repository!.saveCar(car));
  });
  // Attach rejection handling before switching; the old UI result is deliberately canceled.
  const canceled = expect(write).rejects.toThrow('session changed');
  await registerSignup(project, account(), true);
  act(() => cloud.emit(account()));
  await act(async () => {
    release();
    await canceled;
  });
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.snapshot.cars).toEqual([car]);
  expect((await new LocalRepository().load()).cars).toEqual([]);
});

it('shows cloud load errors without opening a local garage, and retry reloads cloud data', async () => {
  cloud.emit(account());
  cloud.execute.mockResolvedValueOnce({ data: null, error: new Error('Cloud unavailable') });
  const hook = await openGarage();
  expect(hook.result.current.repository).toBeNull();
  expect(hook.result.current.error).toEqual({ code: 'load' });
  act(() => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.user?.id).toBe(account().id);
});

it('restores and transfers safely when React Strict Mode mounts effects twice', async () => {
  const { LocalRepository } = await import('./repository');
  const { registerSignup } = await import('./signup-transfer');
  await new LocalRepository().saveCar(car);
  await registerSignup(project, account(), true);
  cloud.emit(account());
  const { useGarageSession } = await import('./use-garage-session');
  const hook = renderHook(() => useGarageSession(), {
    wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
  });
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.snapshot.cars).toEqual([car]);
  expect((await new LocalRepository().load()).cars).toEqual([]);
  expect(cloud.execute.mock.calls.filter(([, operation]) => operation === 'upsert')).toHaveLength(
    1,
  );
});

describe.each(['local', 'cloud'] as const)('%s mutation recovery', (mode) => {
  it('resolves committed writes on refresh failure and retries only reads without losing the snapshot', async () => {
    if (mode === 'cloud') cloud.emit(account());
    const { LocalRepository, SupabaseRepository } = await import('./repository');
    const { AppError } = await import('./app-error');
    const hook = await openGarage();
    await act(async () => {
      expect(
        await hook.result.current.run(() => hook.result.current.repository!.saveCar(car)),
      ).toEqual({ refreshed: true });
    });
    const prototype = mode === 'cloud' ? SupabaseRepository.prototype : LocalRepository.prototype;
    const load = vi.spyOn(prototype, 'load');
    const save = vi.spyOn(prototype, 'saveCar');
    load.mockRejectedValueOnce(new AppError('sessionExpired'));
    const updated = { ...car, name: 'Saved change' };
    await act(async () => {
      expect(
        await hook.result.current.run(() => hook.result.current.repository!.saveCar(updated)),
      ).toEqual({ refreshed: false });
    });
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.refreshError).toEqual({ code: 'refresh' });
    expect(hook.result.current.snapshot.cars).toEqual([car]);
    expect(hook.result.current.refreshing).toBe(false);
    load.mockRejectedValueOnce(new Error('Still unavailable'));
    await act(async () => hook.result.current.refresh());
    expect(hook.result.current.refreshError).toEqual({ code: 'refresh' });
    expect(hook.result.current.snapshot.cars).toEqual([car]);
    await act(async () => hook.result.current.refresh());
    expect(hook.result.current.snapshot.cars).toEqual([updated]);
    expect(hook.result.current.refreshError).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

it('rejects a failed mutation without refreshing and releases the operation lock', async () => {
  const { LocalRepository } = await import('./repository');
  const hook = await openGarage();
  const load = vi.spyOn(LocalRepository.prototype, 'load');
  const cause = new Error('Write failed');
  await act(async () => {
    await expect(
      hook.result.current.run(async () => {
        throw cause;
      }),
    ).rejects.toBe(cause);
  });
  expect(hook.result.current.error).toEqual({ code: 'save' });
  expect(hook.result.current.refreshError).toBeNull();
  expect(load).not.toHaveBeenCalled();
  await act(async () => {
    await hook.result.current.run(() => hook.result.current.repository!.saveCar(car));
  });
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.snapshot.cars).toEqual([car]);
});

it('serializes refresh and mutations and keeps the last snapshot while refreshing', async () => {
  const { LocalRepository } = await import('./repository');
  await new LocalRepository().saveCar(car);
  const hook = await openGarage();
  let release!: (data: typeof hook.result.current.snapshot) => void;
  const load = vi.spyOn(LocalRepository.prototype, 'load').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  let refresh!: Promise<void>;
  act(() => {
    refresh = hook.result.current.refresh();
  });
  expect(hook.result.current.refreshing).toBe(true);
  expect(hook.result.current.snapshot.cars).toEqual([car]);
  const action = vi.fn(async () => {});
  await act(async () => {
    await hook.result.current.refresh();
    await expect(hook.result.current.run(action)).rejects.toThrow('current operation');
  });
  expect(action).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => {
    release({ cars: [car], schedules: [], visits: [] });
    await refresh;
  });
  expect(hook.result.current.refreshing).toBe(false);
  await act(async () => {
    expect(await hook.result.current.run(action)).toEqual({ refreshed: true });
  });
  expect(action).toHaveBeenCalledOnce();
});

it('ignores an in-flight refresh from an account that has signed out', async () => {
  cloud.emit(account());
  const { LocalRepository, SupabaseRepository } = await import('./repository');
  await new LocalRepository().saveCar(car);
  const hook = await openGarage();
  let release!: () => void;
  vi.spyOn(SupabaseRepository.prototype, 'load').mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        release = () => reject(new Error('Old refresh failed'));
      }),
  );
  let refresh!: Promise<void>;
  act(() => {
    refresh = hook.result.current.refresh();
  });
  await act(async () => hook.result.current.signOut());
  expect(hook.result.current.refreshing).toBe(false);
  await act(async () => {
    release();
    await refresh;
  });
  await waitFor(() => expect(hook.result.current.repository).not.toBeNull());
  expect(hook.result.current.user).toBeNull();
  expect(hook.result.current.snapshot.cars).toEqual([car]);
  expect(hook.result.current.refreshError).toBeNull();
});

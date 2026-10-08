import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { account, fakeSupabase } from '../test/fake-supabase';
import { car, schedule, visit } from '../test/fixtures';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
const project = 'https://garage.supabase.co';
let cloud: ReturnType<typeof fakeSupabase>;

beforeEach(async () => {
  await clear();
  vi.resetModules();
  vi.doMock('react', () => React);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', project);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
  cloud = fakeSupabase();
  vi.mocked(createClient).mockReturnValue(
    cloud.client as unknown as ReturnType<typeof createClient>,
  );
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

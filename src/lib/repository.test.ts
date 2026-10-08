import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { account, fakeSupabase } from '../test/fake-supabase';
import { car, schedule, visit } from '../test/fixtures';
import type { Car } from './model';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

beforeEach(async () => {
  await clear();
  vi.resetModules();
});

describe.each(['local', 'cloud'] as const)('%s plate persistence', (mode) => {
  async function setup() {
    const { LocalRepository, SupabaseRepository } = await import('./repository');
    const cloud = fakeSupabase();
    cloud.emit(account());
    return {
      cloud,
      repository:
        mode === 'local'
          ? new LocalRepository()
          : new SupabaseRepository(cloud.client, account().id),
    };
  }

  it.each([undefined, null, '', 'AbC  - 123'])(
    'loads legacy or saved plate %s without losing other records',
    async (plate) => {
      const { repository, cloud } = await setup();
      await repository.saveCar(car);
      await repository.saveSchedule(schedule);
      await repository.saveVisit(visit);
      if (mode === 'local') {
        const legacy = { ...car, plate };
        if (plate === undefined) delete (legacy as Partial<typeof legacy>).plate;
        await set('garage-guardian:local:v1', {
          cars: [legacy],
          schedules: [schedule],
          visits: [visit],
        });
      } else {
        const row = cloud.tables.get('cars')!.get(car.id)!;
        row.plate = plate;
        if (plate === undefined) delete row.plate;
      }
      expect(await repository.load()).toEqual({
        cars: [{ ...car, plate: plate ?? '' }],
        schedules: [schedule],
        visits: [visit],
      });
    },
  );

  it.each([undefined, null, '', '   ', '  AbC  - 123  ', 'x'.repeat(20), '🚗'.repeat(20)])(
    'normalizes and round-trips plate %s on save',
    async (plate) => {
      const { repository, cloud } = await setup();
      const input = { ...car, plate } as unknown as Car;
      await repository.saveCar(input);
      const expected = (plate ?? '').trim();
      expect((await repository.load()).cars).toEqual([{ ...car, plate: expected }]);
      expect(input.plate).toBe(plate);
      if (mode === 'cloud') expect(cloud.tables.get('cars')!.get(car.id)!.plate).toBe(expected);
      await repository.saveCar({ ...car, plate: '' });
      expect((await repository.load()).cars[0].plate).toBe('');
    },
  );

  it.each(['x'.repeat(21), '🚗'.repeat(21)])(
    'rejects overlength plates without overwriting the saved car',
    async (plate) => {
      const { repository, cloud } = await setup();
      await repository.saveCar({ ...car, plate: 'Original' });
      cloud.from.mockClear();
      await expect(repository.saveCar({ ...car, plate: ` ${plate} ` })).rejects.toThrow(
        'License plate must be 20 characters or fewer.',
      );
      expect(cloud.from).not.toHaveBeenCalled();
      expect((await repository.load()).cars[0]).toEqual({ ...car, plate: 'Original' });
    },
  );
});

describe.each([
  ['local prototype', false, false],
  ['configured guest', true, false],
  ['configured authenticated account', true, true],
] as const)('%s storage workflow', (_name, configured, authenticated) => {
  it('persists cars, schedules, visits and photos exclusively in the selected store', async () => {
    const cloud = fakeSupabase();
    vi.mocked(createClient).mockReturnValue(
      cloud.client as unknown as ReturnType<typeof createClient>,
    );
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', configured ? 'https://garage.supabase.co' : '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', configured ? 'test-key' : '');
    if (authenticated) cloud.emit(account());
    const { createRepository, isCloudConfigured } = await import('./repository');
    expect(isCloudConfigured).toBe(configured);
    const repository = createRepository(authenticated ? account().id : undefined);
    await repository.saveCar(car);
    await repository.saveSchedule(schedule);
    const photo = await repository.uploadPhoto(
      visit.id,
      new File(['photo bytes'], 'receipt.webp', { type: 'image/webp' }),
    );
    await repository.saveVisit({ ...visit, photos: [photo] });
    const reloaded = createRepository(authenticated ? account().id : undefined);
    expect(await reloaded.load()).toEqual({
      cars: [car],
      schedules: [schedule],
      visits: [{ ...visit, photos: [photo] }],
    });
    await reloaded.saveCar({ ...car, distanceUnit: 'kilometers', reminderMiles: 1000 });
    expect((await reloaded.load()).cars[0]).toEqual({
      ...car,
      distanceUnit: 'kilometers',
      reminderMiles: 1000,
    });
    await reloaded.saveCar({ ...car, name: 'Updated driver' });
    await reloaded.saveSchedule({ ...schedule, intervalMiles: 6000 });
    await reloaded.saveVisit({ ...visit, notes: 'Updated notes', photos: [photo] });
    expect((await reloaded.load()).visits[0].notes).toBe('Updated notes');

    if (authenticated) {
      expect(await get('garage-guardian:local:v1')).toBeUndefined();
      expect(await get(`photo:${photo.path}`)).toBeUndefined();
      expect(cloud.tables.get('cars')?.get(car.id)?.user_id).toBe(account().id);
      expect(cloud.photos.get(photo.path)?.size).toBe(11);
      expect(await reloaded.photoUrl(photo)).toContain(photo.path);
    } else {
      expect(cloud.from).not.toHaveBeenCalled();
      expect(cloud.bucket.upload).not.toHaveBeenCalled();
      expect(await get(`photo:${photo.path}`)).toBeInstanceOf(Blob);
      expect(await get('garage-guardian:local:v1')).toBeDefined();
    }
    await reloaded.deleteVisit({ ...visit, photos: [photo] });
    expect((await reloaded.load()).visits).toEqual([]);
    expect(await get(`photo:${photo.path}`)).toBeUndefined();
    expect(cloud.photos.has(photo.path)).toBe(false);
    await reloaded.deleteSchedule(schedule.id);
    await reloaded.deleteCar(car.id);
    expect(await reloaded.load()).toEqual({ cars: [], schedules: [], visits: [] });
  });
});

it('loads legacy guest records as Miles without rewriting readings or custom windows', async () => {
  const legacy: Partial<typeof car> = { ...car };
  delete legacy.distanceUnit;
  await set('garage-guardian:local:v1', {
    cars: [{ ...legacy, reminderMiles: 123 }],
    schedules: [schedule],
    visits: [visit],
  });
  const { LocalRepository } = await import('./repository');
  const local = new LocalRepository();
  expect(await local.load()).toEqual({
    cars: [{ ...car, reminderMiles: 123 }],
    schedules: [schedule],
    visits: [visit],
  });
  await local.saveCar({ ...(await local.load()).cars[0], name: 'Edited legacy' });
  expect((await get<{ cars: (typeof car)[] }>('garage-guardian:local:v1'))?.cars[0]).toMatchObject({
    distanceUnit: 'miles',
    odometer: car.odometer,
    reminderMiles: 123,
  });
});

it('normalizes legacy cloud records and preserves zero kilometer reminder windows', async () => {
  const cloud = fakeSupabase();
  cloud.emit(account());
  const { SupabaseRepository } = await import('./repository');
  const repository = new SupabaseRepository(cloud.client, account().id);
  await repository.saveCar(car);
  const row = cloud.tables.get('cars')!.get(car.id)!;
  delete row.distance_unit;
  expect((await repository.load()).cars[0]).toEqual(car);
  await repository.saveCar({ ...car, distanceUnit: 'kilometers', reminderMiles: 0 });
  expect((await repository.load()).cars[0]).toMatchObject({
    distanceUnit: 'kilometers',
    reminderMiles: 0,
  });
  row.distance_unit = 'kilometers';
  row.reminder_miles = null;
  cloud.tables.get('cars')!.set(car.id, row);
  expect((await repository.load()).cars[0].reminderMiles).toBe(1000);
});

it('does not lose simultaneous local writes', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
  const { createRepository } = await import('./repository');
  const local = createRepository();
  await Promise.all([local.saveCar(car), local.saveCar({ ...car, id: 'other' })]);
  expect((await local.load()).cars).toHaveLength(2);
});

it('does not fall back to local storage after a cloud write failure', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://garage.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
  const cloud = fakeSupabase();
  cloud.emit(account());
  vi.mocked(createClient).mockReturnValue(
    cloud.client as unknown as ReturnType<typeof createClient>,
  );
  const { createRepository } = await import('./repository');
  cloud.execute.mockResolvedValueOnce({ data: null, error: new Error('Cloud unavailable') });
  await expect(createRepository(account().id).saveCar(car)).rejects.toThrow('Cloud unavailable');
  expect(await get('garage-guardian:local:v1')).toBeUndefined();
});

it.each(['local', 'cloud'] as const)(
  '%s visit save survives old-photo cleanup failure and continues cleaning remaining photos',
  async (mode) => {
    const { LocalRepository, SupabaseRepository } = await import('./repository');
    const { startDiagnostics, recentDiagnostics, clearDiagnostics } =
      await import('./bug-reports/diagnostics');
    const cloud = fakeSupabase();
    cloud.emit(account());
    const repository =
      mode === 'local' ? new LocalRepository() : new SupabaseRepository(cloud.client, account().id);
    await repository.saveCar(car);
    const file = new File(['receipt'], 'receipt.webp', { type: 'image/webp' });
    const old = await repository.uploadPhoto(visit.id, file);
    const removed = await repository.uploadPhoto(visit.id, file);
    const retained = await repository.uploadPhoto(visit.id, file);
    await repository.saveVisit({ ...visit, photos: [old, removed, retained] });
    const uploaded = await repository.uploadPhoto(visit.id, file);
    const updated = { ...visit, notes: 'Saved edit', photos: [retained, uploaded] };
    const cleanup = vi
      .spyOn(repository, 'removePhoto')
      .mockRejectedValueOnce(new Error('Cleanup failed'));
    const stop = startDiagnostics();
    try {
      await expect(repository.saveVisit(updated)).resolves.toBeUndefined();
      expect((await repository.load()).visits).toEqual([updated]);
      expect(cleanup.mock.calls.map(([photo]) => photo.path)).toEqual([old.path, removed.path]);
      expect(recentDiagnostics().some((entry) => entry.message === 'Cleanup failed')).toBe(true);
      if (mode === 'local') {
        expect(await get(`photo:${uploaded.path}`)).toBeInstanceOf(Blob);
        expect(await get(`photo:${retained.path}`)).toBeInstanceOf(Blob);
        expect(await get(`photo:${removed.path}`)).toBeUndefined();
      } else {
        expect(cloud.photos.has(uploaded.path)).toBe(true);
        expect(cloud.photos.has(retained.path)).toBe(true);
        expect(cloud.photos.has(removed.path)).toBe(false);
      }
    } finally {
      stop();
      clearDiagnostics();
    }
  },
);

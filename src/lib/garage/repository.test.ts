import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { account, fakeSupabase } from '../../test/fake-supabase';
import { car, fuelEntry, schedule, visit } from '../../test/fixtures';
import type { Car } from './model';
import { getAllDue } from '../maintenance/due';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

beforeEach(async () => {
  await clear();
  vi.resetModules();
});
afterEach(() => vi.useRealTimers());

describe.each(['local', 'cloud'] as const)('%s vehicle archive', (mode) => {
  async function setup() {
    const { LocalRepository, SupabaseRepository } = await import('./repository');
    const cloud = fakeSupabase();
    cloud.emit(account());
    const repository =
      mode === 'local'
        ? new LocalRepository()
        : new SupabaseRepository(cloud.client, account().id, true);
    await repository.saveCar(car);
    await repository.saveSchedule(schedule);
    const photo = await repository.uploadPhoto(
      visit.id,
      new File(['receipt bytes'], 'receipt.webp', { type: 'image/webp' }),
    );
    await repository.saveVisit({ ...visit, photos: [photo] });
    return { repository, cloud, photo };
  }

  it('defaults legacy vehicles to active and changes only the archive flag across reloads and edits', async () => {
    const { repository, cloud, photo } = await setup();
    if (mode === 'local') {
      const saved = await repository.load();
      delete (saved.cars[0] as Partial<Car>).isArchived;
      await set('garage-guardian:local:v1', saved);
    } else delete cloud.tables.get('cars')!.get(car.id)!.is_archived;
    const before = await repository.load();
    expect(before.cars[0].isArchived).toBe(false);
    for (const archived of [true, false, true]) {
      await repository.setCarArchived(car.id, archived);
      const after = await repository.load();
      expect(after.cars[0]).toEqual({ ...before.cars[0], isArchived: archived });
      expect(after.visits).toEqual(before.visits);
      expect(after.schedules).toEqual(before.schedules);
      const blob =
        mode === 'local' ? await get<Blob>(`photo:${photo.path}`) : cloud.photos.get(photo.path);
      expect(await blob!.text()).toBe('receipt bytes');
    }
    const archived = (await repository.load()).cars[0];
    await repository.saveCar({ ...car, name: 'Stale active editor' });
    expect((await repository.load()).cars[0].isArchived).toBe(true);
    await repository.setCarArchived(car.id, false);
    await repository.saveCar(archived);
    expect((await repository.load()).cars[0].isArchived).toBe(false);
    await repository.setCarArchived(car.id, true);
    await repository.saveCar({ ...archived, name: 'Edited archived vehicle' });
    expect((await repository.load()).cars[0]).toMatchObject({
      isArchived: true,
      name: 'Edited archived vehicle',
    });
    await repository.saveVisit({ ...before.visits[0], notes: 'Late receipt' });
    await repository.saveSchedule({ ...schedule, sourceNote: 'Updated while archived' });
    expect((await repository.load()).visits[0].notes).toBe('Late receipt');
    await repository.deleteCar(car.id);
    expect((await repository.load()).cars).toEqual([]);
    expect((await repository.load()).visits).toEqual([]);
    expect((await repository.load()).schedules).toEqual([]);
  });

  it('rejects a missing or inaccessible vehicle instead of reporting success', async () => {
    const { repository } = await setup();
    await expect(repository.setCarArchived('missing', true)).rejects.toThrow();
  });
});

it('requires online cloud archive saves and retains the successful flag in cached snapshots', async () => {
  const { SupabaseRepository } = await import('./repository');
  const cloud = fakeSupabase();
  cloud.emit(account());
  const repository = new SupabaseRepository(cloud.client, account().id, true);
  await repository.saveCar(car);
  await repository.load();
  await repository.setCarArchived(car.id, true);
  cloud.execute.mockRejectedValue(new TypeError('Failed to fetch'));
  expect((await repository.load()).cars[0].isArchived).toBe(true);
  await expect(repository.setCarArchived(car.id, false)).rejects.toThrow('Failed to fetch');
  expect((await repository.load()).cars[0].isArchived).toBe(true);
  expect(cloud.tables.get('cars')!.get(car.id)!.is_archived).toBe(true);
});

it('scopes cloud archive updates to the repository owner and authenticated owner', async () => {
  const { SupabaseRepository } = await import('./repository');
  const cloud = fakeSupabase();
  cloud.emit(account());
  const owner = new SupabaseRepository(cloud.client, account().id);
  await owner.saveCar(car);
  const other = new SupabaseRepository(cloud.client, 'other');
  await expect(other.setCarArchived(car.id, true)).rejects.toThrow();
  cloud.emit(account('other'));
  await expect(owner.setCarArchived(car.id, true)).rejects.toThrow();
  expect(cloud.tables.get('cars')!.get(car.id)!.is_archived).toBe(false);
});

it('keeps committed archive/restore authoritative when cache writes and the following network read fail', async () => {
  const { SupabaseRepository } = await import('./repository');
  const { OfflineReceipts } = await import('../currency/offline-receipts');
  const cloud = fakeSupabase();
  cloud.emit(account());
  const repository = new SupabaseRepository(cloud.client, account().id, true);
  await repository.saveCar(car);
  await repository.load();
  vi.spyOn(OfflineReceipts.prototype, 'rememberCarArchived').mockRejectedValue(
    new Error('Disk full'),
  );
  const execute = cloud.execute.getMockImplementation()!;
  for (const archived of [true, false]) {
    cloud.execute.mockImplementation(execute);
    await expect(repository.setCarArchived(car.id, archived)).resolves.toBeUndefined();
    expect(cloud.tables.get('cars')!.get(car.id)!.is_archived).toBe(archived);
    cloud.execute.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await repository.load()).cars[0].isArchived).toBe(archived);
  }
});

describe('atomic cloud schedule saves', () => {
  it.each(['car', 'visit'] as const)(
    'initializes a new task from a concurrent %s reading at save time',
    async (source) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-13T19:00:00Z'));
      const { SupabaseRepository } = await import('./repository');
      const cloud = fakeSupabase();
      cloud.emit(account());
      const repository = new SupabaseRepository(cloud.client, account().id);
      await repository.saveCar({ ...car, odometer: 69000 });
      const execute = cloud.execute.getMockImplementation()!;
      cloud.execute.mockImplementation(async (...args) => {
        if (args[0] === 'schedule_items' && args[1] === 'upsert') {
          if (source === 'car') cloud.tables.get('cars')!.get(car.id)!.odometer = 71000;
          else
            cloud.tables.set(
              'visits',
              new Map([
                [
                  visit.id,
                  {
                    id: visit.id,
                    user_id: account().id,
                    car_id: car.id,
                    service_date: visit.date,
                    odometer: 71000,
                    items: [],
                    photos: [],
                  },
                ],
              ]),
            );
        }
        return execute(...args);
      });

      await repository.saveSchedule({ ...schedule, firstDueMiles: null, firstDueDate: null });

      expect(cloud.tables.get('schedule_items')!.get(schedule.id)).toMatchObject({
        first_due_miles: 75000,
        first_due_date: '2027-04-13',
      });
      const saved = await repository.load();
      expect(getAllDue(saved.cars, saved.schedules, saved.visits, '2026-10-13')[0].status).toBe(
        'later',
      );
    },
  );

  it('reports an atomic save failure without persisting an uninitialized task', async () => {
    const { SupabaseRepository } = await import('./repository');
    const cloud = fakeSupabase();
    cloud.emit(account());
    const repository = new SupabaseRepository(cloud.client, account().id);
    await repository.saveCar(car);
    cloud.rpc.mockResolvedValueOnce({ data: [], error: new Error('Atomic save failed') });
    await expect(
      repository.saveSchedule({ ...schedule, firstDueMiles: null, firstDueDate: null }),
    ).rejects.toThrow('Atomic save failed');
    expect(cloud.tables.get('schedule_items')?.has(schedule.id)).toBeFalsy();
  });
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

  it('persists interval-only milestones and dates across reloads and odometer updates', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T19:00:00Z'));
    const { repository } = await setup();
    await repository.saveCar({ ...car, odometer: 69000 });
    await repository.saveSchedule({ ...schedule, firstDueMiles: null, firstDueDate: null });
    const initial = await repository.load();
    expect(initial.schedules[0]).toMatchObject({
      firstDueMiles: 70000,
      firstDueDate: '2027-04-13',
    });
    vi.setSystemTime(new Date('2026-10-20T19:00:00Z'));
    await repository.saveCar({ ...car, odometer: 71000 });
    const reloaded = await repository.load();
    expect(reloaded.schedules).toEqual(initial.schedules);
    expect(
      getAllDue(reloaded.cars, reloaded.schedules, reloaded.visits, '2026-10-20')[0].status,
    ).toBe('due');
  });

  it('initializes existing interval-only records once without changing explicit due points', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T19:00:00Z'));
    const { repository, cloud } = await setup();
    await repository.saveCar({ ...car, odometer: 69000 });
    await repository.saveSchedule(schedule);
    const legacy = { ...schedule, firstDueMiles: null, firstDueDate: null };
    if (mode === 'local') {
      await set('garage-guardian:local:v1', {
        cars: [{ ...car, odometer: 69000 }],
        schedules: [legacy],
        visits: [],
      });
    } else {
      Object.assign(cloud.tables.get('schedule_items')!.get(schedule.id)!, {
        first_due_miles: null,
        first_due_date: null,
      });
    }
    const first = await repository.load();
    expect(first.schedules[0]).toMatchObject({ firstDueMiles: 70000, firstDueDate: '2027-04-13' });
    vi.setSystemTime(new Date('2026-11-13T19:00:00Z'));
    expect((await repository.load()).schedules).toEqual(first.schedules);
    await repository.saveSchedule(schedule);
    expect((await repository.load()).schedules).toEqual([schedule]);
    if (mode === 'cloud') {
      expect(cloud.rpc).toHaveBeenCalledWith('initialize_schedule_defaults', {
        p_user_id: account().id,
        p_schedule_id: schedule.id,
        p_car_id: car.id,
        p_interval_miles: schedule.intervalMiles,
        p_interval_months: schedule.intervalMonths,
        p_today: '2026-10-13',
      });
    }
  });

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
        homeCurrency: 'USD',
        cars: [{ ...car, plate: plate ?? '' }],
        schedules: [schedule],
        visits: [visit],
        fuelEntries: [],
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
      homeCurrency: 'USD',
      cars: [car],
      schedules: [schedule],
      visits: [{ ...visit, photos: [photo] }],
      fuelEntries: [],
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
      expect(cloud.bucket.createSignedUrl).toHaveBeenLastCalledWith(photo.path, 60, {
        download: photo.name,
      });
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
    expect(await reloaded.load()).toEqual({
      homeCurrency: 'USD',
      cars: [],
      schedules: [],
      visits: [],
      fuelEntries: [],
    });
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
    homeCurrency: 'USD',
    cars: [{ ...car, reminderMiles: 123 }],
    schedules: [schedule],
    visits: [visit],
    fuelEntries: [],
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
      await import('../feedback/diagnostics');
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

describe.each(['local', 'cloud'] as const)('%s fill-ups', (mode) => {
  async function setup() {
    const { LocalRepository, SupabaseRepository } = await import('./repository');
    const cloud = fakeSupabase();
    cloud.emit(account());
    const repository =
      mode === 'local'
        ? new LocalRepository()
        : new SupabaseRepository(cloud.client, account().id, true);
    await repository.saveCar(car);
    const upload = (name: string) =>
      repository.uploadPhoto(fuelEntry.id, new File([name], name, { type: 'image/webp' }));
    const stored = async (path: string) =>
      mode === 'local' ? await get<Blob>(`photo:${path}`) : cloud.photos.get(path);
    return { repository, cloud, upload, stored };
  }

  it('saves, edits, and deletes fill-ups with their photos', async () => {
    const { repository, upload, stored } = await setup();
    const kept = await upload('kept.webp');
    const dropped = await upload('dropped.webp');
    await repository.saveFuelEntry({ ...fuelEntry, station: ' Corner ', photos: [kept, dropped] });
    expect((await repository.load()).fuelEntries).toEqual([
      { ...fuelEntry, station: 'Corner', photos: [kept, dropped] },
    ]);
    await repository.saveFuelEntry({ ...fuelEntry, notes: 'Edited', photos: [kept] });
    expect((await repository.load()).fuelEntries).toEqual([
      { ...fuelEntry, notes: 'Edited', photos: [kept] },
    ]);
    expect(await stored(dropped.path)).toBeUndefined();
    expect(await stored(kept.path)).toBeInstanceOf(Blob);
    await repository.deleteFuelEntry({ ...fuelEntry, photos: [kept] });
    expect((await repository.load()).fuelEntries).toEqual([]);
    expect(await stored(kept.path)).toBeUndefined();
  });

  it('rejects invalid fill-ups without saving them', async () => {
    const { repository } = await setup();
    await expect(repository.saveFuelEntry({ ...fuelEntry, volumeMilli: 0 })).rejects.toMatchObject({
      code: 'fuelFields',
    });
    expect((await repository.load()).fuelEntries).toEqual([]);
  });

  it('deletes fill-ups and their photos with the vehicle', async () => {
    const { repository, upload, stored } = await setup();
    const photo = await upload('receipt.webp');
    await repository.saveFuelEntry({ ...fuelEntry, photos: [photo] });
    await repository.deleteCar(car.id);
    expect((await repository.load()).fuelEntries).toEqual([]);
    expect(await stored(photo.path)).toBeUndefined();
  });

  it('counts fill-up readings in the first due baseline of a new interval-only task', async () => {
    const { repository } = await setup();
    await repository.saveFuelEntry({ ...fuelEntry, odometer: 12_345 });
    await repository.saveSchedule({ ...schedule, firstDueMiles: null, intervalMonths: null });
    expect((await repository.load()).schedules[0].firstDueMiles).toBe(15_000);
  });
});

it('loads guest snapshots saved before fill-ups existed', async () => {
  await set('garage-guardian:local:v1', { cars: [car], schedules: [], visits: [] });
  const { LocalRepository } = await import('./repository');
  const local = new LocalRepository();
  expect((await local.load()).fuelEntries).toEqual([]);
  await local.saveFuelEntry(fuelEntry);
  expect((await local.load()).fuelEntries).toEqual([fuelEntry]);
});

it('keeps cached fill-ups readable offline but does not queue offline fill-up saves', async () => {
  const { SupabaseRepository } = await import('./repository');
  const cloud = fakeSupabase();
  cloud.emit(account());
  const repository = new SupabaseRepository(cloud.client, account().id, true);
  await repository.saveCar(car);
  await repository.saveFuelEntry(fuelEntry);
  await repository.load();
  cloud.execute.mockRejectedValue(new TypeError('Failed to fetch'));
  expect((await repository.load()).fuelEntries).toEqual([fuelEntry]);
  await expect(
    repository.saveFuelEntry({ ...fuelEntry, id: 'offline', odometer: 500 }),
  ).rejects.toThrow('Failed to fetch');
  expect((await repository.load()).fuelEntries).toEqual([fuelEntry]);
});

it.each(['fill-up', 'vehicle'] as const)(
  'removes fill-ups from the offline cache when a %s is deleted',
  async (target) => {
    const { SupabaseRepository } = await import('./repository');
    const cloud = fakeSupabase();
    cloud.emit(account());
    const repository = new SupabaseRepository(cloud.client, account().id, true);
    await repository.saveCar(car);
    await repository.saveFuelEntry(fuelEntry);
    await repository.load();
    const execute = cloud.execute.getMockImplementation()!;
    // The delete succeeds, then the connection drops before the garage can refresh.
    cloud.execute.mockImplementation(async (...args) => {
      const result = await execute(...args);
      if (args[1] === 'delete') cloud.execute.mockRejectedValue(new TypeError('Failed to fetch'));
      return result;
    });
    if (target === 'fill-up') await repository.deleteFuelEntry(fuelEntry);
    else await repository.deleteCar(car.id);
    expect((await repository.load()).fuelEntries).toEqual([]);
  },
);

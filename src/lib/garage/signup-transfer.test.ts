import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import { LocalRepository, SupabaseRepository } from './repository';
import { pendingTransfer, registerSignup, transferSignupData } from './signup-transfer';
import { account, fakeSupabase } from '../../test/fake-supabase';
import { car, fuelEntry, schedule, visit } from '../../test/fixtures';
import { addMonths } from '../maintenance/due';
import { todayISO } from '../utils/today-iso';

const project = 'https://garage.supabase.co';
beforeEach(async () => {
  await clear();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

async function seedLocal(withPhoto = true) {
  const local = new LocalRepository();
  await local.saveCar(car);
  await local.saveSchedule(schedule);
  const photos = withPhoto
    ? [
        await local.uploadPhoto(
          visit.id,
          new File(['receipt'], 'receipt.webp', { type: 'image/webp' }),
        ),
      ]
    : [];
  await local.saveVisit({ ...visit, photos });
  return { local, snapshot: await local.load(), photo: photos[0] };
}

describe('signup transfer', () => {
  it('transfers archived vehicles with editable history and identical receipt bytes', async () => {
    const { local, photo } = await seedLocal();
    await local.setCarArchived(car.id, true);
    const before = await local.load();
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    await transferSignupData(cloud.client, project, account().id);
    const repository = new SupabaseRepository(cloud.client, account().id);
    const saved = await repository.load();
    expect(saved.cars).toEqual([{ ...car, isArchived: true }]);
    expect(saved.schedules).toEqual(before.schedules);
    expect(saved.visits[0]).toEqual({
      ...before.visits[0],
      photos: [{ ...photo, path: `${account().id}/${visit.id}/${photo.id}.webp` }],
    });
    expect(await cloud.photos.get(saved.visits[0].photos[0].path)!.text()).toBe('receipt');
    await repository.setCarArchived(car.id, false);
    expect((await repository.load()).cars[0].isArchived).toBe(false);
  });
  it('reports upload and verification stages without changing transfer completion', async () => {
    const { local } = await seedLocal();
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    const progress = vi.fn();
    await transferSignupData(cloud.client, project, account().id, () => {}, progress);
    expect(progress.mock.calls.map(([value]) => value.phase)).toEqual([
      'records',
      'uploading',
      'verifyingPhoto',
      'records',
      'verifying',
      'cleanup',
    ]);
    expect(progress).toHaveBeenCalledWith({ phase: 'uploading', current: 1, total: 1 });
    expect(await pendingTransfer(project)).toBeUndefined();
    expect((await local.load()).cars).toEqual([]);
  });
  it.each(['none', 'metadata', 'due point', 'new task'] as const)(
    'cleans up legacy uploaded defaults across days without removing guest changes (%s)',
    async (edit) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-13T19:00:00Z'));
      const { local, snapshot: saved, photo } = await seedLocal();
      const intervalOnly = { ...schedule, firstDueMiles: null, firstDueDate: null };
      const snapshot = { ...saved, schedules: [intervalOnly] };
      await set(`garage-guardian:signup-transfer:v1:${project}`, {
        userId: account().id,
        status: 'uploaded',
        snapshot,
      });
      await set('garage-guardian:local:v1', {
        ...snapshot,
        schedules:
          edit === 'new task'
            ? [intervalOnly, { ...intervalOnly, id: '55555555-5555-4555-8555-555555555555' }]
            : [intervalOnly],
      });
      const guest = await local.load();
      expect(guest.schedules[0].firstDueDate).toBe('2027-04-13');
      const edited = {
        ...guest.schedules[0],
        ...(edit === 'metadata' ? { sourceNote: 'New guest notes' } : {}),
        // This date also matches a naive initialization using the later retry date.
        ...(edit === 'due point' ? { firstDueDate: '2027-04-20' } : {}),
      };
      if (edit === 'metadata' || edit === 'due point') await local.saveSchedule(edited);

      vi.setSystemTime(new Date('2026-10-20T19:00:00Z'));
      vi.resetModules();
      const reloaded = await import('./signup-transfer');
      const cloud = fakeSupabase();
      cloud.emit(account());
      await reloaded.transferSignupData(cloud.client, project, account().id);

      expect(await local.load()).toEqual({
        homeCurrency: 'USD',
        cars: edit === 'none' ? [] : [car],
        schedules: edit === 'none' ? [] : edit === 'new task' ? [guest.schedules[1]] : [edited],
        visits: [],
        fuelEntries: [],
      });
      expect(await get(`photo:${photo.path}`)).toBeUndefined();
      expect(cloud.from).not.toHaveBeenCalled();
      expect(cloud.rpc).not.toHaveBeenCalled();
      expect(cloud.bucket.upload).not.toHaveBeenCalled();
      expect(await pendingTransfer(project)).toBeUndefined();
    },
  );

  it.each(['none', 'metadata', 'due point'] as const)(
    'cleans up initialized guest schedules after retry (guest edit: %s)',
    async (edit) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-13T19:00:00Z'));
      const { local, snapshot: saved, photo } = await seedLocal();
      const snapshot = {
        ...saved,
        schedules: [{ ...schedule, firstDueMiles: null, firstDueDate: null }],
      };
      await set('garage-guardian:local:v1', snapshot);
      await set(`garage-guardian:signup-transfer:v1:${project}`, {
        userId: account().id,
        status: 'uploading',
        snapshot,
      });
      const cloud = fakeSupabase();
      cloud.emit(account());
      cloud.bucket.upload.mockResolvedValueOnce({ error: new Error('Upload interrupted') });
      await expect(transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
        'Upload interrupted',
      );

      cloud.emit(null);
      const guest = await local.load();
      expect(guest.schedules[0]).toMatchObject({ firstDueMiles: 5000, firstDueDate: '2027-04-13' });
      expect((await pendingTransfer(project))?.snapshot).toEqual(snapshot);
      const edited = {
        ...guest.schedules[0],
        ...(edit === 'metadata' ? { sourceNote: 'New guest notes' } : {}),
        ...(edit === 'due point' ? { firstDueDate: '2028-01-01' } : {}),
      };
      if (edit !== 'none') await local.saveSchedule(edited);

      vi.resetModules();
      const reloaded = await import('./signup-transfer');
      cloud.emit(account());
      await reloaded.transferSignupData(cloud.client, project, account().id);

      expect(await local.load()).toEqual({
        homeCurrency: 'USD',
        cars: edit === 'none' ? [] : [car],
        schedules: edit === 'none' ? [] : [edited],
        visits: [],
        fuelEntries: [],
      });
      expect(await get(`photo:${photo.path}`)).toBeUndefined();
      expect(cloud.tables.get('schedule_items')!.get(schedule.id)).toMatchObject({
        source_note: schedule.sourceNote,
        first_due_date: '2027-04-13',
      });
      expect(await pendingTransfer(project)).toBeUndefined();
    },
  );

  it('keeps legacy transfer due dates fixed across failed uploads and later-day reload retries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T19:00:00Z'));
    const { local, snapshot: saved } = await seedLocal();
    const snapshot = {
      ...saved,
      schedules: [{ ...schedule, firstDueMiles: null, firstDueDate: null }],
    };
    await set('garage-guardian:local:v1', snapshot);
    await set(`garage-guardian:signup-transfer:v1:${project}`, {
      userId: account().id,
      status: 'uploading',
      snapshot,
    });
    const cloud = fakeSupabase();
    cloud.emit(account());
    const execute = cloud.execute.getMockImplementation()!;
    cloud.execute.mockImplementationOnce(async (...args) => {
      expect((await pendingTransfer(project))?.baselineDate).toBe('2026-10-13');
      return execute(...args);
    });
    cloud.bucket.upload
      .mockResolvedValueOnce({ error: new Error('Upload interrupted') })
      .mockResolvedValueOnce({ error: new Error('Upload interrupted') });
    await expect(transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
      'Upload interrupted',
    );
    expect(cloud.tables.get('schedule_items')!.get(schedule.id)!.first_due_date).toBe('2027-04-13');
    expect((await pendingTransfer(project))?.snapshot).toEqual(snapshot);

    vi.resetModules();
    const reloaded = await import('./signup-transfer');
    vi.setSystemTime(new Date('2026-10-20T19:00:00Z'));
    await expect(reloaded.transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
      'Upload interrupted',
    );
    expect(cloud.tables.get('schedule_items')!.get(schedule.id)!.first_due_date).toBe('2027-04-13');
    expect((await reloaded.pendingTransfer(project))?.snapshot).toEqual(snapshot);
    expect((await reloaded.pendingTransfer(project))?.baselineDate).toBe('2026-10-13');

    vi.setSystemTime(new Date('2026-10-28T19:00:00Z'));
    await reloaded.transferSignupData(cloud.client, project, account().id);
    expect(cloud.tables.get('schedule_items')!.get(schedule.id)!.first_due_date).toBe('2027-04-13');
    expect(await local.load()).toEqual({
      homeCurrency: 'USD',
      cars: [],
      schedules: [],
      visits: [],
      fuelEntries: [],
    });
    expect(await pendingTransfer(project)).toBeUndefined();
  });

  it.each([false, true])(
    'resumes interval-only schedules from a frozen legacy upload (interrupted: %s)',
    async (interrupted) => {
      const { local, snapshot: saved } = await seedLocal();
      const snapshot = {
        ...saved,
        cars: [{ ...car, odometer: 69000 }],
        schedules: [{ ...schedule, firstDueMiles: null, firstDueDate: null }],
        visits: [{ ...saved.visits[0], odometer: 71000 }],
      };
      await set('garage-guardian:local:v1', snapshot);
      await set(`garage-guardian:signup-transfer:v1:${project}`, {
        userId: account().id,
        status: 'uploading',
        snapshot,
      });
      const cloud = fakeSupabase();
      cloud.emit(account());
      if (interrupted) {
        cloud.bucket.upload.mockResolvedValueOnce({ error: new Error('Upload interrupted') });
        await expect(transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
          'Upload interrupted',
        );
        expect((await pendingTransfer(project))?.snapshot).toEqual(snapshot);
        expect(await get('garage-guardian:local:v1')).toEqual(snapshot);
      }

      await transferSignupData(cloud.client, project, account().id);

      const transferred = await new SupabaseRepository(cloud.client, account().id).load();
      expect(transferred.schedules).toEqual([
        {
          ...schedule,
          firstDueMiles: 75000,
          firstDueDate: addMonths(todayISO(), 6),
        },
      ]);
      expect(transferred.visits[0].odometer).toBe(71000);
      expect(await local.load()).toEqual({
        homeCurrency: 'USD',
        cars: [],
        schedules: [],
        visits: [],
        fuelEntries: [],
      });
      expect(await pendingTransfer(project)).toBeUndefined();
    },
  );

  it.each(['pending', 'uploading', 'uploaded'])(
    'resumes a legacy %s transfer and cleans up equivalent guest records',
    async (status) => {
      const legacyCar: Partial<typeof car> = { ...car };
      delete legacyCar.distanceUnit;
      delete legacyCar.plate;
      const snapshot = { cars: [legacyCar], schedules: [schedule], visits: [visit] };
      await set('garage-guardian:local:v1', snapshot);
      await set(`garage-guardian:signup-transfer:v1:${project}`, {
        userId: account().id,
        status,
        snapshot,
      });
      const cloud = fakeSupabase();
      cloud.emit(account());
      await transferSignupData(cloud.client, project, account().id);
      expect(await new LocalRepository().load()).toEqual({
        homeCurrency: 'USD',
        cars: [],
        schedules: [],
        visits: [],
        fuelEntries: [],
      });
      expect(await pendingTransfer(project)).toBeUndefined();
      if (status !== 'uploaded') {
        expect((await new SupabaseRepository(cloud.client, account().id).load()).cars).toEqual([
          car,
        ]);
      }
    },
  );

  it('preserves a saved plate through a failed upload and a reload retry', async () => {
    const { local, photo } = await seedLocal();
    const plated = { ...car, plate: 'AbC  - 123' };
    await local.saveCar(plated);
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    cloud.bucket.upload.mockResolvedValueOnce({ error: new Error('Upload failed') });
    await expect(transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
      'Upload failed',
    );
    expect((await pendingTransfer(project))?.snapshot?.cars).toEqual([plated]);
    expect((await local.load()).cars).toEqual([plated]);
    expect(await local.readPhoto(photo)).toBeInstanceOf(Blob);
    vi.resetModules();
    const reloaded = await import('./signup-transfer');
    await reloaded.transferSignupData(cloud.client, project, account().id);
    expect((await new SupabaseRepository(cloud.client, account().id).load()).cars).toEqual([
      plated,
    ]);
    expect(await local.load()).toEqual({
      homeCurrency: 'USD',
      cars: [],
      schedules: [],
      visits: [],
      fuelEntries: [],
    });
    expect(await pendingTransfer(project)).toBeUndefined();
  });

  it('keeps a legacy pending snapshot frozen and preserves a concurrent guest plate edit', async () => {
    const legacyCar: Partial<typeof car> = { ...car };
    delete legacyCar.plate;
    const snapshot = { cars: [legacyCar], schedules: [], visits: [] };
    await set('garage-guardian:local:v1', snapshot);
    await set(`garage-guardian:signup-transfer:v1:${project}`, {
      userId: account().id,
      status: 'uploading',
      snapshot,
    });
    const cloud = fakeSupabase();
    cloud.emit(account());
    const local = new LocalRepository();
    const originalLoad = SupabaseRepository.prototype.load;
    vi.spyOn(SupabaseRepository.prototype, 'load').mockImplementationOnce(async function (
      this: SupabaseRepository,
    ) {
      expect((await pendingTransfer(project))?.snapshot).toEqual(snapshot);
      await local.saveCar({ ...car, plate: 'New local plate' });
      return originalLoad.call(this);
    });
    await transferSignupData(cloud.client, project, account().id);
    expect((await new SupabaseRepository(cloud.client, account().id).load()).cars).toEqual([car]);
    expect((await local.load()).cars).toEqual([{ ...car, plate: 'New local plate' }]);
    expect(await pendingTransfer(project)).toBeUndefined();
  });

  it('retains a populated plate when cloud verification returns a different value', async () => {
    const { local } = await seedLocal(false);
    const plated = { ...car, plate: 'AbC-123' };
    await local.saveCar(plated);
    const cloud = fakeSupabase();
    cloud.emit(account());
    vi.spyOn(SupabaseRepository.prototype, 'load').mockResolvedValueOnce({
      cars: [car],
      schedules: [schedule],
      visits: [visit],
      fuelEntries: [],
    });
    await registerSignup(project, account(), true);
    await expect(transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
      'upload could not be verified',
    );
    expect((await local.load()).cars).toEqual([plated]);
    expect((await pendingTransfer(project))?.status).toBe('uploading');
  });

  it('preserves kilometer units, readings, and maintenance intervals during signup transfer', async () => {
    const { local } = await seedLocal(false);
    const metric = { ...car, distanceUnit: 'kilometers' as const, reminderMiles: 1000 };
    await local.saveCar(metric);
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    await transferSignupData(cloud.client, project, account().id);
    expect(await new SupabaseRepository(cloud.client, account().id).load()).toEqual({
      homeCurrency: 'USD',
      cars: [metric],
      schedules: [schedule],
      visits: [visit],
      fuelEntries: [],
    });
    expect(await local.load()).toEqual({
      homeCurrency: 'USD',
      cars: [],
      schedules: [],
      visits: [],
      fuelEntries: [],
    });
  });

  it('uploads the whole garage and photo blobs, preserves relationships, and clears the browser copy', async () => {
    const { local, snapshot, photo } = await seedLocal();
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    await transferSignupData(cloud.client, project, account().id);
    const saved = await new SupabaseRepository(cloud.client, account().id).load();
    expect(saved.cars).toEqual(snapshot.cars);
    expect(saved.schedules).toEqual(snapshot.schedules);
    expect(saved.visits[0]).toEqual({
      ...snapshot.visits[0],
      photos: [{ ...photo, path: `${account().id}/${visit.id}/${photo.id}.webp` }],
    });
    expect(cloud.photos.size).toBe(1);
    expect(await [...cloud.photos.values()][0].text()).toBe('receipt');
    expect(await local.load()).toEqual({
      homeCurrency: 'USD',
      cars: [],
      schedules: [],
      visits: [],
      fuelEntries: [],
    });
    expect(await get(`photo:${photo.path}`)).toBeUndefined();
    expect(await pendingTransfer(project)).toBeUndefined();
    const writes = cloud.execute.mock.calls.filter(([, operation]) => operation === 'upsert');
    expect(writes.map(([table]) => table)).toEqual([
      'garage_settings',
      'cars',
      'schedule_items',
      'visits',
    ]);
  });

  it('retains all local data on a partial failure and retries without duplicate rows or photos', async () => {
    const { local, snapshot, photo } = await seedLocal();
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    cloud.bucket.upload.mockResolvedValueOnce({ error: new Error('Upload failed') });
    await expect(transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
      'Upload failed',
    );
    expect(await local.load()).toEqual(snapshot);
    expect(await local.readPhoto(photo)).toBeInstanceOf(Blob);
    expect((await pendingTransfer(project))?.status).toBe('uploading');
    await transferSignupData(cloud.client, project, account().id);
    expect(cloud.tables.get('cars')?.size).toBe(1);
    expect(cloud.tables.get('schedule_items')?.size).toBe(1);
    expect(cloud.tables.get('visits')?.size).toBe(1);
    expect(cloud.photos.size).toBe(1);
  });

  it('keeps records when a referenced local photo is missing', async () => {
    const { local, snapshot, photo } = await seedLocal();
    await local.removePhoto(photo);
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    await expect(transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
      'no longer available',
    );
    expect(await local.load()).toEqual(snapshot);
  });

  it('retains browser data when cloud verification fails', async () => {
    const { local, snapshot } = await seedLocal(false);
    const cloud = fakeSupabase();
    cloud.emit(account());
    const load = vi
      .spyOn(SupabaseRepository.prototype, 'load')
      .mockResolvedValueOnce({ cars: [], schedules: [], visits: [], fuelEntries: [] });
    await registerSignup(project, account(), true);
    await expect(transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
      'could not be verified',
    );
    expect(await local.load()).toEqual(snapshot);
    load.mockRestore();
  });

  it('keeps the local photo if uploaded bytes are corrupted without changing the file size', async () => {
    const { local, snapshot, photo } = await seedLocal();
    const cloud = fakeSupabase();
    cloud.emit(account());
    cloud.bucket.download.mockResolvedValueOnce({ data: new Blob(['corrupt']), error: null });
    await registerSignup(project, account(), true);
    await expect(transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
      'photo upload could not be verified',
    );
    expect(await local.load()).toEqual(snapshot);
    expect(await (await local.readPhoto(photo)).text()).toBe('receipt');
  });

  it('retries cleanup without overwriting cloud edits or requiring already-deleted local photos', async () => {
    const { local, photo } = await seedLocal();
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    vi.spyOn(LocalRepository.prototype, 'removePhoto').mockRejectedValueOnce(
      new Error('Cleanup interrupted'),
    );
    await expect(transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
      'Cleanup interrupted',
    );
    expect((await pendingTransfer(project))?.status).toBe('uploaded');
    await new SupabaseRepository(cloud.client, account().id).saveCar({
      ...car,
      name: 'Edited in cloud',
    });
    cloud.execute.mockClear();
    cloud.bucket.upload.mockClear();
    await transferSignupData(cloud.client, project, account().id);
    expect(cloud.execute.mock.calls.some(([, operation]) => operation === 'upsert')).toBe(false);
    expect(cloud.bucket.upload).not.toHaveBeenCalled();
    expect(cloud.tables.get('cars')?.get(car.id)?.name).toBe('Edited in cloud');
    expect(await get(`photo:${photo.path}`)).toBeUndefined();
    expect(await local.load()).toEqual({
      homeCurrency: 'USD',
      cars: [],
      schedules: [],
      visits: [],
      fuelEntries: [],
    });
  });

  it('does not transfer on ordinary sign-in, to another account, or to another project', async () => {
    const { local, snapshot } = await seedLocal();
    const cloud = fakeSupabase();
    cloud.emit(account());
    await transferSignupData(cloud.client, project, account().id);
    expect(cloud.from).not.toHaveBeenCalled();
    await registerSignup(project, account(), false);
    await transferSignupData(cloud.client, project, account('different').id);
    await transferSignupData(cloud.client, 'https://other.supabase.co', account().id);
    expect(cloud.from).not.toHaveBeenCalled();
    expect(await local.load()).toEqual(snapshot);
  });

  it('does not authorize an existing-account signup response or replace another pending account', async () => {
    await registerSignup(project, { ...account(), identities: [] }, false);
    expect(await pendingTransfer(project)).toBeUndefined();
    await registerSignup(project, account(), false);
    await expect(registerSignup(project, account('different'), true)).rejects.toThrow(
      'previous account transfer',
    );
    expect((await pendingTransfer(project))?.userId).toBe(account().id);
  });

  it('serializes duplicate transfer attempts', async () => {
    await seedLocal();
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    await Promise.all([
      transferSignupData(cloud.client, project, account().id),
      transferSignupData(cloud.client, project, account().id),
    ]);
    expect(cloud.bucket.upload).toHaveBeenCalledTimes(1);
  });

  it('takes a browser lock so transfers in separate tabs cannot run concurrently', async () => {
    await seedLocal();
    const cloud = fakeSupabase();
    cloud.emit(account());
    let lock = Promise.resolve();
    const request = vi.fn((_name: string, callback: () => Promise<void>) => {
      const work = lock.then(callback);
      lock = work.catch(() => {});
      return work;
    });
    vi.stubGlobal('navigator', { locks: { request } });
    await registerSignup(project, account(), true);
    // A fresh module instance has its own in-memory queue, like a separate tab.
    vi.resetModules();
    const otherTab = await import('./signup-transfer');
    await Promise.all([
      transferSignupData(cloud.client, project, account().id),
      otherTab.transferSignupData(cloud.client, project, account().id),
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(cloud.bucket.upload).toHaveBeenCalledTimes(1);
    expect(await pendingTransfer(project)).toBeUndefined();
  });

  it('stops after a session change and keeps the local copy for retry', async () => {
    const { local, snapshot } = await seedLocal();
    const cloud = fakeSupabase();
    cloud.emit(account());
    let active = true;
    cloud.bucket.download.mockImplementationOnce(async () => {
      active = false;
      return { data: new Blob(['receipt']), error: null };
    });
    await registerSignup(project, account(), true);
    await expect(
      transferSignupData(cloud.client, project, account().id, () => {
        if (!active) throw new Error('Session changed');
      }),
    ).rejects.toThrow('Session changed');
    expect(cloud.tables.get('visits')?.size ?? 0).toBe(0);
    expect(await local.load()).toEqual(snapshot);
  });

  it('preserves guest edits and photo references made after the frozen transfer started', async () => {
    const { local, snapshot } = await seedLocal();
    const cloud = fakeSupabase();
    cloud.emit(account());
    await set(`garage-guardian:signup-transfer:v1:${project}`, {
      userId: account().id,
      status: 'uploaded',
      snapshot,
    });
    const edited = { ...snapshot.visits[0], notes: 'New guest notes' };
    await local.saveVisit(edited);
    await transferSignupData(cloud.client, project, account().id);
    const remaining = await local.load();
    expect(remaining.visits).toEqual([edited]);
    expect(remaining.cars).toEqual([car]);
    expect(remaining.schedules).toEqual([schedule]);
    expect(await local.readPhoto(edited.photos[0])).toBeInstanceOf(Blob);
  });
});

describe('signup transfer of fill-ups', () => {
  async function seedFuel() {
    const { local, photo } = await seedLocal();
    const fuelPhoto = await local.uploadPhoto(
      fuelEntry.id,
      new File(['pump receipt'], 'pump.webp', { type: 'image/webp' }),
    );
    await local.saveFuelEntry({ ...fuelEntry, photos: [fuelPhoto] });
    return { local, photo, fuelPhoto };
  }

  it('uploads and verifies fill-ups with their photos, then clears the browser copy', async () => {
    const { local, fuelPhoto } = await seedFuel();
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    const progress = vi.fn();
    await transferSignupData(cloud.client, project, account().id, () => {}, progress);
    const cloudPath = `${account().id}/${fuelEntry.id}/${fuelPhoto.id}.webp`;
    const saved = await new SupabaseRepository(cloud.client, account().id).load();
    expect(saved.fuelEntries).toEqual([
      { ...fuelEntry, photos: [{ ...fuelPhoto, path: cloudPath }] },
    ]);
    expect(await cloud.photos.get(cloudPath)!.text()).toBe('pump receipt');
    expect(progress).toHaveBeenCalledWith({ phase: 'uploading', current: 2, total: 2 });
    expect((await local.load()).fuelEntries).toEqual([]);
    expect(await get(`photo:${fuelPhoto.path}`)).toBeUndefined();
    expect(await pendingTransfer(project)).toBeUndefined();
  });

  it('keeps local fill-ups and photos when the uploaded copy cannot be verified', async () => {
    const { local, fuelPhoto } = await seedFuel();
    const before = await local.load();
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    const load = SupabaseRepository.prototype.load;
    vi.spyOn(SupabaseRepository.prototype, 'load').mockImplementationOnce(async function (
      this: InstanceType<typeof SupabaseRepository>,
    ) {
      const snapshot = await load.call(this);
      return { ...snapshot, fuelEntries: [] };
    });
    await expect(transferSignupData(cloud.client, project, account().id)).rejects.toThrow(
      'upload could not be verified',
    );
    expect(await local.load()).toEqual(before);
    expect(await local.readPhoto(fuelPhoto)).toBeInstanceOf(Blob);
    expect((await pendingTransfer(project))?.status).toBe('uploading');
  });

  it('keeps a fill-up edited during the transfer and the vehicle it needs', async () => {
    const { local } = await seedFuel();
    const cloud = fakeSupabase();
    cloud.emit(account());
    await registerSignup(project, account(), true);
    const save = SupabaseRepository.prototype.saveFuelEntry;
    vi.spyOn(SupabaseRepository.prototype, 'saveFuelEntry').mockImplementationOnce(async function (
      this: InstanceType<typeof SupabaseRepository>,
      entry,
    ) {
      await save.call(this, entry);
      await local.saveFuelEntry({ ...entry, notes: 'Edited in another tab', photos: [] });
    });
    await transferSignupData(cloud.client, project, account().id);
    const remaining = await local.load();
    expect(remaining.fuelEntries).toMatchObject([
      { id: fuelEntry.id, notes: 'Edited in another tab' },
    ]);
    expect(remaining.cars.map((item) => item.id)).toEqual([car.id]);
  });
});

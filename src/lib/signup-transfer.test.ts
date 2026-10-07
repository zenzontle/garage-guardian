import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import { LocalRepository, SupabaseRepository } from './repository';
import { pendingTransfer, registerSignup, transferSignupData } from './signup-transfer';
import { account, fakeSupabase } from '../test/fake-supabase';
import { car, schedule, visit } from '../test/fixtures';

const project = 'https://garage.supabase.co';
beforeEach(async () => {
  await clear();
});

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
  it.each(['pending', 'uploading', 'uploaded'])(
    'resumes a legacy %s transfer and cleans up equivalent guest records',
    async (status) => {
      const { distanceUnit: _unit, plate: _plate, ...legacyCar } = car;
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
      expect(await new LocalRepository().load()).toEqual({ cars: [], schedules: [], visits: [] });
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
    expect(await local.load()).toEqual({ cars: [], schedules: [], visits: [] });
    expect(await pendingTransfer(project)).toBeUndefined();
  });

  it('keeps a legacy pending snapshot frozen and preserves a concurrent guest plate edit', async () => {
    const { plate: _plate, ...legacyCar } = car;
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
      cars: [metric],
      schedules: [schedule],
      visits: [visit],
    });
    expect(await local.load()).toEqual({ cars: [], schedules: [], visits: [] });
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
    expect(await local.load()).toEqual({ cars: [], schedules: [], visits: [] });
    expect(await get(`photo:${photo.path}`)).toBeUndefined();
    expect(await pendingTransfer(project)).toBeUndefined();
    const writes = cloud.execute.mock.calls.filter(([, operation]) => operation === 'upsert');
    expect(writes.map(([table]) => table)).toEqual(['cars', 'schedule_items', 'visits']);
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
      .mockResolvedValueOnce({ cars: [], schedules: [], visits: [] });
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
    expect(await local.load()).toEqual({ cars: [], schedules: [], visits: [] });
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

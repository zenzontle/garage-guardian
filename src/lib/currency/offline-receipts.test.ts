import { beforeEach, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { SupabaseRepository } from '../garage/repository';
import { account, fakeSupabase } from '@/test/fake-supabase';
import { car, visit } from '@/test/fixtures';
import { receiptInputs, type Currency } from './currency';

beforeEach(async () => clear());
it('persists offline account receipts across reload, isolates accounts, and syncs on retry', async () => {
  const cloud = fakeSupabase();
  cloud.emit(account());
  const repository = new SupabaseRepository(cloud.client, account().id, true);
  await repository.saveCar(car);
  await repository.load();
  const execute = cloud.execute.getMockImplementation()!;
  cloud.execute.mockRejectedValue(new TypeError('Failed to fetch'));
  const receipt = { ...visit, currency: 'MXN' as Currency };
  const manual = {
    ...receiptInputs(receipt),
    source: 'manual' as const,
    rate: null,
    rateDate: null,
    convertedCents: 800,
  };
  await repository.saveVisit({ ...receipt, conversions: { USD: manual } }, ['USD']);
  expect((await repository.load()).pendingSyncCount).toBe(1);
  const reopened = new SupabaseRepository(cloud.client, account().id, true);
  expect((await reopened.load()).visits[0].conversions?.USD).toEqual(manual);
  const other = new SupabaseRepository(cloud.client, 'other', true);
  await expect(other.load()).rejects.toThrow('Failed to fetch');
  cloud.execute.mockImplementation(execute);
  const synced = await reopened.load();
  expect(synced.pendingSyncCount).toBeUndefined();
  expect(synced.visits[0]).toMatchObject({
    currency: 'MXN',
    totalCostCents: 15000,
    conversions: { USD: manual },
  });
});
it('surfaces authorization errors rather than treating them as offline success', async () => {
  const cloud = fakeSupabase();
  cloud.emit(account());
  const repository = new SupabaseRepository(cloud.client, account().id, true);
  await repository.saveCar(car);
  await repository.load();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  cloud.execute.mockRejectedValue(new Error('Owner policy denied write'));
  await expect(repository.saveVisit(visit)).rejects.toThrow('Owner policy');
});
it('does not replay an older queued receipt after a newer online save or deletion', async () => {
  const cloud = fakeSupabase();
  cloud.emit(account());
  const repository = new SupabaseRepository(cloud.client, account().id, true);
  await repository.saveCar(car);
  await repository.load();
  const execute = cloud.execute.getMockImplementation()!;
  cloud.execute.mockRejectedValue(new TypeError('Failed to fetch'));
  await repository.saveVisit({ ...visit, notes: 'Offline' });
  cloud.execute.mockImplementation(execute);
  await repository.saveVisit({ ...visit, notes: 'Newer online' });
  expect((await repository.load()).visits[0].notes).toBe('Newer online');
  cloud.execute.mockRejectedValue(new TypeError('Failed to fetch'));
  await repository.saveVisit({ ...visit, notes: 'Offline edit' });
  cloud.execute.mockImplementation(execute);
  await repository.deleteVisit(visit);
  expect((await repository.load()).visits).toEqual([]);
});
it('retains a queued manual override through a subsequent unrelated online edit', async () => {
  const cloud = fakeSupabase();
  cloud.emit(account());
  const repository = new SupabaseRepository(cloud.client, account().id, true);
  await repository.saveCar(car);
  await repository.saveVisit(visit);
  await repository.load();
  const execute = cloud.execute.getMockImplementation()!;
  cloud.execute.mockRejectedValue(new TypeError('Failed to fetch'));
  const manual = {
    ...receiptInputs(visit),
    source: 'manual' as const,
    convertedCents: 20000,
    rate: null,
    rateDate: null,
  };
  await repository.saveVisit({ ...visit, conversions: { CAD: manual } }, ['CAD']);
  cloud.execute.mockImplementation(execute);
  await repository.saveVisit({ ...visit, notes: 'Only notes changed' });
  expect((await repository.load()).visits[0]).toMatchObject({
    notes: 'Only notes changed',
    conversions: { CAD: manual },
  });
});
it('serializes a delayed outbox flush with deletes across repository instances', async () => {
  const cloud = fakeSupabase();
  cloud.emit(account());
  const repository = new SupabaseRepository(cloud.client, account().id, true);
  const otherTab = new SupabaseRepository(cloud.client, account().id, true);
  await repository.saveCar(car);
  await repository.load();
  const execute = cloud.execute.getMockImplementation()!;
  cloud.execute.mockRejectedValue(new TypeError('Failed to fetch'));
  await repository.saveVisit(visit);
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    cloud.execute.mockImplementation(async (...args) => {
      if (args[0] === 'visits' && args[1] === 'upsert') {
        resolve();
        await new Promise<void>((done) => {
          release = done;
        });
      }
      return execute(...args);
    });
  });
  const flushing = repository.load();
  await started;
  const deleting = otherTab.deleteVisit(visit);
  release();
  await Promise.all([flushing, deleting]);
  expect((await repository.load()).visits).toEqual([]);
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { account, fakeSupabase } from '../test/fake-supabase';
import { car, schedule, visit } from '../test/fixtures';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

beforeEach(async () => { await clear(); vi.resetModules(); });

describe.each([
  ['local prototype', false, false],
  ['configured guest', true, false],
  ['configured authenticated account', true, true],
] as const)('%s storage workflow', (_name, configured, authenticated) => {
  it('persists cars, schedules, visits and photos exclusively in the selected store', async () => {
    const cloud = fakeSupabase();
    vi.mocked(createClient).mockReturnValue(cloud.client as unknown as ReturnType<typeof createClient>);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', configured ? 'https://garage.supabase.co' : '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', configured ? 'test-key' : '');
    if (authenticated) cloud.emit(account());
    const { createRepository, isCloudConfigured } = await import('./repository');
    expect(isCloudConfigured).toBe(configured);
    const repository = createRepository(authenticated ? account().id : undefined);
    await repository.saveCar(car);
    await repository.saveSchedule(schedule);
    const photo = await repository.uploadPhoto(visit.id, new File(['photo bytes'], 'receipt.webp', { type: 'image/webp' }));
    await repository.saveVisit({ ...visit, photos: [photo] });
    const reloaded = createRepository(authenticated ? account().id : undefined);
    expect(await reloaded.load()).toEqual({ cars: [car], schedules: [schedule], visits: [{ ...visit, photos: [photo] }] });
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
  vi.mocked(createClient).mockReturnValue(cloud.client as unknown as ReturnType<typeof createClient>);
  const { createRepository } = await import('./repository');
  cloud.execute.mockResolvedValueOnce({ data: null, error: new Error('Cloud unavailable') });
  await expect(createRepository(account().id).saveCar(car)).rejects.toThrow('Cloud unavailable');
  expect(await get('garage-guardian:local:v1')).toBeUndefined();
});

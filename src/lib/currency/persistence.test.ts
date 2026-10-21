import { beforeEach, describe, expect, it } from 'vitest';
import { clear, set } from 'idb-keyval';
import { LocalRepository, SupabaseRepository } from '../garage/repository';
import { account, fakeSupabase } from '@/test/fake-supabase';
import { car, visit } from '@/test/fixtures';
import { automaticConversion, receiptInputs, type Currency } from './currency';
import { pendingTransfer, registerSignup, transferSignupData } from '../garage/signup-transfer';

beforeEach(async () => clear());
const foreign = { ...visit, currency: 'MXN' as Currency };
const automatic = automaticConversion(receiptInputs(foreign), {
  rate: 0.05,
  rateDate: foreign.date,
});
const manual = {
  ...automatic,
  source: 'manual' as const,
  convertedCents: 999,
  rate: null,
  rateDate: null,
};
describe.each(['local', 'cloud'])('%s currency storage', (mode) => {
  async function setup() {
    const cloud = fakeSupabase();
    cloud.emit(account());
    const repository =
      mode === 'local' ? new LocalRepository() : new SupabaseRepository(cloud.client, account().id);
    await repository.saveCar(car);
    await repository.saveVisit(foreign);
    return { repository, cloud };
  }
  it('round trips preferences, conversions, and manual overrides', async () => {
    const { repository } = await setup();
    await repository.saveHomeCurrency('CAD');
    await repository.saveConversion(foreign, 'USD', automatic);
    await repository.saveVisit({ ...foreign, conversions: { USD: manual } }, ['USD']);
    await repository.saveConversion(foreign, 'USD', automatic);
    const loaded = await repository.load();
    expect(loaded.homeCurrency).toBe('CAD');
    expect(loaded.visits[0]).toMatchObject({
      currency: 'MXN',
      totalCostCents: 15000,
      conversions: { USD: manual },
    });
    await repository.saveHomeCurrency('USD');
    expect((await repository.load()).visits[0].conversions?.USD).toEqual(manual);
    await repository.saveVisit({
      ...foreign,
      notes: 'Unrelated change',
      conversions: { USD: automatic },
    });
    expect((await repository.load()).visits[0].conversions?.USD).toEqual(manual);
    await repository.saveVisit(
      { ...foreign, conversions: { USD: { ...manual, convertedCents: 1000 } } },
      ['USD'],
    );
    await repository.saveVisit({
      ...foreign,
      notes: 'Stale tab notes',
      conversions: { USD: manual },
    });
    expect((await repository.load()).visits[0].conversions?.USD?.convertedCents).toBe(1000);
  });
  it.each([{ date: '2026-09-24' }, { totalCostCents: 16000 }, { currency: 'CAD' as Currency }])(
    'rejects stale background saves after edit %j',
    async (patch) => {
      const { repository } = await setup();
      await repository.saveConversion(foreign, 'USD', automatic);
      await repository.saveVisit({ ...foreign, conversions: { USD: automatic }, ...patch });
      await repository.saveConversion(foreign, 'USD', automatic);
      expect((await repository.load()).visits[0].conversions).toEqual({});
    },
  );
  it('does not resurrect deleted receipts from background work', async () => {
    const { repository } = await setup();
    await repository.deleteVisit(foreign);
    await repository.saveConversion(foreign, 'USD', automatic);
    expect((await repository.load()).visits).toEqual([]);
  });
});
it('isolates account settings and conversion writes', async () => {
  const cloud = fakeSupabase();
  cloud.emit(account());
  const owner = new SupabaseRepository(cloud.client, account().id);
  await owner.saveHomeCurrency('MXN');
  await owner.saveCar(car);
  await owner.saveVisit(foreign);
  cloud.emit(account('other'));
  const other = new SupabaseRepository(cloud.client, 'other');
  expect((await other.load()).homeCurrency).toBe('USD');
  await other.saveConversion(foreign, 'USD', automatic);
  await expect(owner.saveHomeCurrency('CAD')).rejects.toThrow();
  cloud.emit(account());
  expect((await owner.load()).visits[0].conversions).toEqual({});
  expect((await owner.load()).homeCurrency).toBe('MXN');
});
it.each(['new', 'legacy-resume'])(
  'verifies signup transfer preferences and conversions (%s)',
  async (mode) => {
    const local = new LocalRepository();
    await local.saveCar(car);
    await local.saveHomeCurrency('CAD');
    await local.saveVisit({ ...foreign, conversions: { USD: manual } }, ['USD']);
    const cloud = fakeSupabase();
    cloud.emit(account());
    const project = 'currency-test';
    if (mode === 'legacy-resume') {
      const legacy = { ...visit };
      delete legacy.currency;
      delete legacy.conversions;
      await set(`garage-guardian:signup-transfer:v1:${project}`, {
        userId: account().id,
        status: 'uploading',
        snapshot: { cars: [car], schedules: [], visits: [legacy] },
      });
      await set('garage-guardian:local:v1', { cars: [car], schedules: [], visits: [legacy] });
    } else await registerSignup(project, account(), true);
    await transferSignupData(cloud.client, project, account().id);
    const saved = await new SupabaseRepository(cloud.client, account().id).load();
    expect(saved.homeCurrency).toBe(mode === 'new' ? 'CAD' : 'USD');
    expect(saved.visits[0]).toMatchObject(
      mode === 'new'
        ? { currency: 'MXN', conversions: { USD: manual } }
        : { currency: 'USD', conversions: {} },
    );
    expect(await pendingTransfer(project)).toBeUndefined();
    expect((await local.load()).visits).toEqual([]);
  },
);

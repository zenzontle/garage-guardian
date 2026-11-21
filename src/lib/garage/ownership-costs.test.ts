import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, set } from 'idb-keyval';
import { account, fakeSupabase } from '../../test/fake-supabase';
import { car, expense, fuelEntry } from '../../test/fixtures';
import { automaticConversion } from '../currency/currency';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

beforeEach(async () => {
  await clear();
  vi.resetModules();
});

const peso = { ...fuelEntry, currency: 'MXN' as const, totalCostCents: 100000 };
const usd = automaticConversion(
  { currency: 'MXN', date: peso.date, totalCostCents: 100000 },
  { rate: 0.05, rateDate: peso.date },
);

describe.each(['local', 'cloud'] as const)('%s other costs and fill-up conversions', (mode) => {
  async function setup() {
    const { LocalRepository, SupabaseRepository } = await import('./repository');
    const cloud = fakeSupabase();
    cloud.emit(account());
    const repository =
      mode === 'local'
        ? new LocalRepository()
        : new SupabaseRepository(cloud.client, account().id, true);
    await repository.saveCar(car);
    return { repository, cloud };
  }

  it('saves, edits, and deletes other costs', async () => {
    const { repository } = await setup();
    await repository.saveExpense(expense);
    expect((await repository.load()).expenses).toEqual([expense]);
    await repository.saveExpense({ ...expense, notes: 'Renewed online' });
    expect((await repository.load()).expenses).toEqual([{ ...expense, notes: 'Renewed online' }]);
    await repository.deleteExpense(expense);
    expect((await repository.load()).expenses).toEqual([]);
  });

  it('rejects a cost whose renewal is not after its date', async () => {
    const { repository } = await setup();
    await expect(repository.saveExpense({ ...expense, renewsOn: expense.date })).rejects.toThrow();
  });

  it('deletes a vehicle’s costs with the vehicle', async () => {
    const { repository } = await setup();
    await repository.saveExpense(expense);
    await repository.deleteCar(car.id);
    expect((await repository.load()).expenses).toEqual([]);
  });

  it('keeps a background fill-up conversion across edits that keep the receipt inputs', async () => {
    const { repository } = await setup();
    await repository.saveFuelEntry(peso);
    await repository.saveFuelConversion(peso, 'USD', usd);
    expect((await repository.load()).fuelEntries[0].conversions).toEqual({ USD: usd });
    await repository.saveFuelEntry({ ...peso, notes: 'Edited', conversions: {} });
    expect((await repository.load()).fuelEntries[0].conversions).toEqual({ USD: usd });
    // A changed total invalidates the saved conversion.
    await repository.saveFuelEntry({ ...peso, totalCostCents: 90000, conversions: {} });
    expect((await repository.load()).fuelEntries[0].conversions).toEqual({});
  });

  it('ignores a delayed conversion for a receipt that changed', async () => {
    const { repository } = await setup();
    const cad = { ...expense, currency: 'CAD' as const };
    await repository.saveExpense(cad);
    await repository.saveExpense({ ...cad, totalCostCents: 1 });
    const conversion = automaticConversion(
      { currency: 'CAD', date: cad.date, totalCostCents: cad.totalCostCents },
      { rate: 0.7, rateDate: cad.date },
    );
    await repository.saveExpenseConversion(cad, 'USD', conversion);
    expect((await repository.load()).expenses[0].conversions).toEqual({});
  });
});

it('loads guest snapshots saved before other costs existed', async () => {
  await set('garage-guardian:local:v1', { cars: [car], schedules: [], visits: [] });
  const { LocalRepository } = await import('./repository');
  const local = new LocalRepository();
  expect((await local.load()).expenses).toEqual([]);
  await local.saveExpense(expense);
  expect((await local.load()).expenses).toEqual([expense]);
});

it('transfers guest costs to a new account and verifies them before clearing', async () => {
  const project = 'https://project.supabase.co';
  const { LocalRepository } = await import('./repository');
  const { registerSignup, transferSignupData } = await import('./signup-transfer');
  const local = new LocalRepository();
  await local.saveCar(car);
  await local.saveExpense(expense);
  const cloud = fakeSupabase();
  cloud.emit(account());
  await registerSignup(project, account(), true);
  await transferSignupData(cloud.client, project, account().id);
  const { SupabaseRepository } = await import('./repository');
  expect((await new SupabaseRepository(cloud.client, account().id).load()).expenses).toEqual([
    expense,
  ]);
  expect((await local.load()).expenses).toEqual([]);
});

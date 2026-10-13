import { expect, it } from 'vitest';
import { loadReminderItems } from './maintenance';
import { reminderStore } from './store.test-helper';

it.each([
  ['miles', 500, 500, 1],
  ['miles', 500, 501, 0],
  ['kilometers', 1000, 1000, 1],
  ['kilometers', 1000, 1001, 0],
  ['kilometers', null, 1000, 1],
  ['kilometers', 0, 1, 0],
  [undefined, 500, 500, 1],
] as const)('preserves %s windows (%s, %s remaining)', async (unit, window, remaining, count) => {
  const store = reminderStore();
  store.addAccount('owner');
  Object.assign(store.tables.cars[0], {
    distance_unit: unit,
    reminder_miles: window,
    odometer: 10000 - remaining,
  });
  expect(await loadReminderItems(store.db, 'owner', '2026-10-05')).toHaveLength(count);
});
it('loads maintenance past the first database page', async () => {
  const store = reminderStore();
  store.addAccount('owner');
  const original = store.tables.schedule_items[0];
  store.tables.schedule_items = Array.from({ length: 501 }, (_, index) => ({
    ...original,
    id: String(index).padStart(4, '0'),
  }));
  expect(await loadReminderItems(store.db, 'owner', '2026-10-05')).toHaveLength(501);
});

it('initializes interval-only reminder targets once and keeps them fixed as mileage advances', async () => {
  const store = reminderStore();
  store.addAccount('owner');
  Object.assign(store.tables.cars[0], { odometer: 69000 });
  Object.assign(store.tables.schedule_items[0], {
    interval_miles: 5000,
    interval_months: 6,
    first_due_miles: null,
  });
  expect(await loadReminderItems(store.db, 'owner', '2026-10-13')).toHaveLength(0);
  expect(store.tables.schedule_items[0]).toMatchObject({
    first_due_miles: 70000,
    first_due_date: '2027-04-13',
  });
  Object.assign(store.tables.cars[0], { odometer: 70100 });
  const due = await loadReminderItems(store.db, 'owner', '2026-10-14');
  expect(due[0]).toMatchObject({ status: 'due', dueMiles: 70000, dueDate: '2027-04-13' });
  expect(
    store.calls.filter((call) => call.table === 'schedule_items' && call.operation === 'update'),
  ).toHaveLength(1);
});

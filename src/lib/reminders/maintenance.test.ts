import { expect, it } from 'vitest';
import { loadReminderItems } from './maintenance';
import { reminderStore } from './store.test-helper';

it('excludes archived vehicles in mixed and empty active garages and restores saved overdue targets', async () => {
  const store = reminderStore();
  store.addAccount('owner');
  const original = { ...store.tables.cars[0], odometer: 11000 };
  store.tables.cars[0] = { ...original, is_archived: true };
  store.tables.cars.push({ ...original, id: 'active-car' });
  store.tables.schedule_items.push({
    ...store.tables.schedule_items[0],
    id: 'active-task',
    car_id: 'active-car',
  });
  const schedules = structuredClone(store.tables.schedule_items);
  const preferences = structuredClone(store.tables.notification_preferences);
  expect(
    (await loadReminderItems(store.db, 'owner', '2026-10-05')).map((item) => item.car.id),
  ).toEqual(['active-car']);
  store.tables.cars[1].is_archived = true;
  expect(await loadReminderItems(store.db, 'owner', '2026-10-05')).toEqual([]);
  store.tables.cars[0].is_archived = false;
  expect(await loadReminderItems(store.db, 'owner', '2026-10-05')).toMatchObject([
    { car: { id: 'owner-car' }, status: 'due', dueMiles: 10000 },
  ]);
  expect(store.tables.schedule_items).toEqual(schedules);
  expect(store.tables.notification_preferences).toEqual(preferences);
});

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
    store.rpc.mock.calls.filter(([name]) => name === 'initialize_schedule_defaults'),
  ).toHaveLength(1);
});

it('uses fill-up odometers for due status and first due baselines', async () => {
  const store = reminderStore();
  store.addAccount('owner');
  const fill = {
    id: 'fill',
    user_id: 'owner',
    car_id: 'owner-car',
    fuel_date: '2026-10-04',
    odometer: 10100,
    volume_milli: 10000,
    volume_unit: 'gallons',
    fuel_type: 'regular',
    unit_price_milli: 3459,
    total_cost_cents: 3459,
    currency: 'USD',
    is_full_tank: true,
    missed_previous: false,
    station: '',
    notes: '',
    photos: [],
    created_at: '2026-10-04T00:00:00.000Z',
  };
  expect(await loadReminderItems(store.db, 'owner', '2026-10-05')).toMatchObject([
    { status: 'upcoming', milesRemaining: 500 },
  ]);
  store.tables.fuel_entries.push(fill, { ...fill, id: 'other', user_id: 'other', odometer: 99999 });
  expect(await loadReminderItems(store.db, 'owner', '2026-10-05')).toMatchObject([
    { status: 'due', milesRemaining: -100 },
  ]);
  Object.assign(store.tables.schedule_items[0], {
    interval_miles: 5000,
    interval_months: null,
    first_due_miles: null,
  });
  await loadReminderItems(store.db, 'owner', '2026-10-05');
  expect(store.tables.schedule_items[0].first_due_miles).toBe(15000);
});

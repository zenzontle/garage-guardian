import { describe, expect, it } from 'vitest';
import { car, schedule, visit } from '@/test/fixtures';
import { account, fakeSupabase } from '@/test/fake-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDueItem } from './due';
import { initializeCloudSchedules, initializeSchedule } from './schedule-defaults';

const intervalOnly = { ...schedule, firstDueMiles: null, firstDueDate: null };

describe('interval-only schedules', () => {
  it.each(['miles', 'kilometers'] as const)(
    'uses native %s milestones and the save date',
    (distanceUnit) => {
      const vehicle = { ...car, distanceUnit, odometer: 69000 };
      const initialized = initializeSchedule(intervalOnly, vehicle, [], '2026-10-13');
      expect(initialized.firstDueMiles).toBe(70000);
      expect(initialized.firstDueDate).toBe('2027-04-13');
      expect(getDueItem(initialized, vehicle, [], '2026-10-13').status).toBe('later');
      expect(
        getDueItem(initialized, { ...vehicle, odometer: 70000 }, [], '2026-10-14').status,
      ).toBe('due');
      expect(
        initializeSchedule(initialized, { ...vehicle, odometer: 71000 }, [], '2026-10-15'),
      ).toBe(initialized);
    },
  );

  it.each([
    [0, 5000],
    [5000, 5000],
    [5001, 10000],
  ])('initializes an odometer of %s at %s', (odometer, due) => {
    const vehicle = { ...car, odometer };
    const initialized = initializeSchedule(
      { ...intervalOnly, intervalMonths: null },
      vehicle,
      [],
      '2026-10-13',
    );
    expect(initialized.firstDueMiles).toBe(due);
    expect(initialized.firstDueDate).toBeNull();
    expect(getDueItem(initialized, vehicle, [], '2026-10-13').status).toBe(
      odometer === due ? 'due' : 'later',
    );
  });

  it('uses the latest known vehicle reading without altering unknown service readings', () => {
    const unknown = { ...visit, id: 'unknown', date: '2026-10-12', odometer: null };
    const initialized = initializeSchedule(
      intervalOnly,
      car,
      [{ ...visit, odometer: 69000 }, unknown],
      '2026-10-13',
    );
    expect(initialized.firstDueMiles).toBe(70000);
    expect(unknown.odometer).toBeNull();
    const due = getDueItem(initialized, car, [unknown], '2026-10-13');
    expect(due.dueMiles).toBe(70000);
    expect(due.dueDate).toBe('2027-04-12');
  });

  it('starts a time-only interval when saved, including month-end clamping', () => {
    const initialized = initializeSchedule(
      { ...intervalOnly, intervalMiles: null, intervalMonths: 1 },
      car,
      [],
      '2026-01-31',
    );
    expect(initialized.firstDueDate).toBe('2026-02-28');
    expect(initialized.firstDueMiles).toBeNull();
    expect(getDueItem(initialized, car, [], '2026-02-28').status).toBe('due');
  });

  it('preserves an explicit date or distance, inactive tasks, and unconfigured starters', () => {
    for (const item of [
      schedule,
      { ...intervalOnly, firstDueDate: '2026-12-01' },
      { ...intervalOnly, isActive: false },
      { ...intervalOnly, intervalMiles: null, intervalMonths: null },
    ]) {
      expect(initializeSchedule(item, car, [], '2026-10-13')).toBe(item);
    }
  });

  it('advances repeats from a linked service instead of the automatic first due point', () => {
    const initialized = initializeSchedule(intervalOnly, car, [], '2026-10-13');
    const due = getDueItem(initialized, car, [{ ...visit, odometer: 5200 }], '2026-10-14');
    expect(due.dueMiles).toBe(10200);
    expect(due.dueDate).toBe('2027-03-25');
  });
});

describe('cloud initialization safeguards', () => {
  function setup() {
    const cloud = fakeSupabase();
    cloud.emit(account());
    const row = {
      id: schedule.id,
      user_id: account().id,
      car_id: car.id,
      name: schedule.name,
      source_note: schedule.sourceNote,
      created_at: schedule.createdAt,
      interval_miles: schedule.intervalMiles,
      interval_months: schedule.intervalMonths,
      is_active: true,
      first_due_miles: null as number | null,
      first_due_date: null as string | null,
    };
    cloud.tables.set(
      'cars',
      new Map([[car.id, { ...car, user_id: account().id, odometer: 69000 }]]),
    );
    cloud.tables.set('schedule_items', new Map([[row.id, row]]));
    return { cloud, row, db: cloud.client as unknown as SupabaseClient };
  }
  const snapshot = {
    cars: [{ ...car, odometer: 69000 }],
    schedules: [intervalOnly],
    visits: [],
    fuelEntries: [],
  };

  it.each([
    { first_due_miles: 75000, first_due_date: '2028-01-01' },
    { interval_miles: 10000 },
    { is_active: false },
  ])('does not overwrite a concurrent edit %j', async (edit) => {
    const { cloud, row, db } = setup();
    const rpc = cloud.rpc.getMockImplementation()!;
    cloud.rpc.mockImplementationOnce(async (...args) => {
      Object.assign(row, edit);
      return rpc(...args);
    });
    const initialized = await initializeCloudSchedules(db, account().id, snapshot, '2026-10-13');
    expect(row).toMatchObject(edit);
    if (!('first_due_miles' in edit)) {
      expect(row.first_due_miles).toBeNull();
      expect(row.first_due_date).toBeNull();
    }
    expect(initialized.schedules[0]).toEqual({
      ...intervalOnly,
      firstDueMiles: row.first_due_miles,
      firstDueDate: row.first_due_date,
      intervalMiles: row.interval_miles,
      isActive: row.is_active,
    });
  });

  it.each(['car', 'visit'] as const)(
    'uses a concurrent %s reading instead of the stale snapshot',
    async (source) => {
      const { cloud, row, db } = setup();
      const rpc = cloud.rpc.getMockImplementation()!;
      cloud.rpc.mockImplementationOnce(async (...args) => {
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
                  odometer: 71000,
                },
              ],
            ]),
          );
        return rpc(...args);
      });
      const initialized = await initializeCloudSchedules(db, account().id, snapshot, '2026-10-13');
      expect(row.first_due_miles).toBe(75000);
      expect(initialized.schedules[0].firstDueMiles).toBe(75000);
      expect(snapshot.cars[0].odometer).toBe(69000);
    },
  );

  it('removes a concurrently deleted schedule instead of returning the old record', async () => {
    const { cloud, db } = setup();
    const rpc = cloud.rpc.getMockImplementation()!;
    cloud.rpc.mockImplementationOnce(async (...args) => {
      cloud.tables.get('schedule_items')!.delete(schedule.id);
      return rpc(...args);
    });
    const initialized = await initializeCloudSchedules(db, account().id, snapshot, '2026-10-13');
    expect(initialized.schedules).toEqual([]);
    expect(snapshot.schedules).toEqual([intervalOnly]);
  });

  it('returns current metadata after another tab edits a task while its defaults are initialized', async () => {
    const { cloud, row, db } = setup();
    const rpc = cloud.rpc.getMockImplementation()!;
    cloud.rpc.mockImplementationOnce(async (...args) => {
      row.name = 'Updated task';
      row.source_note = 'Updated manual';
      return rpc(...args);
    });
    const initialized = await initializeCloudSchedules(db, account().id, snapshot, '2026-10-13');
    expect(initialized.schedules[0]).toMatchObject({
      name: 'Updated task',
      sourceNote: 'Updated manual',
      firstDueMiles: 70000,
    });
  });

  it('cannot initialize another owner’s task', async () => {
    const { row, db } = setup();
    row.user_id = 'another-owner';
    await initializeCloudSchedules(db, account().id, snapshot, '2026-10-13');
    expect(row.first_due_miles).toBeNull();
    expect(row.first_due_date).toBeNull();
  });

  it('reports a failed write instead of returning an unpersisted due point', async () => {
    const { cloud, row, db } = setup();
    cloud.rpc.mockResolvedValueOnce({ data: [], error: new Error('Initialization failed') });
    await expect(
      initializeCloudSchedules(db, account().id, snapshot, '2026-10-13'),
    ).rejects.toThrow('Initialization failed');
    expect(row.first_due_miles).toBeNull();
  });
});

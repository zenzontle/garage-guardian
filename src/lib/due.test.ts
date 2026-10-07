import { describe, expect, it } from 'vitest';
import { addMonths, dueDescription, getDueItem, latestOdometer } from './due';
import type { Car, ScheduleItem, Visit } from './model';

const car: Car = {
  id: 'car-1',
  name: 'RAV4',
  year: 2020,
  make: 'Toyota',
  model: 'RAV4',
  vin: '',
  plate: '',
  distanceUnit: 'miles',
  odometer: 19_500,
  reminderDays: 30,
  reminderMiles: 500,
  createdAt: '2026-01-01T00:00:00Z',
};
const schedule: ScheduleItem = {
  id: 'oil',
  carId: car.id,
  name: 'Oil change',
  intervalMiles: 5_000,
  intervalMonths: 6,
  firstDueMiles: 20_000,
  firstDueDate: '2026-11-01',
  sourceNote: 'Manual',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
};
const visit: Visit = {
  id: 'visit-1',
  carId: car.id,
  date: '2026-09-25',
  odometer: 20_050,
  totalCostCents: 8500,
  provider: 'Dealer',
  notes: '',
  items: [{ id: 'item-1', name: 'Oil change', scheduleItemId: schedule.id, costCents: null }],
  photos: [],
  createdAt: '2026-09-25T00:00:00Z',
};

describe('due calculations', () => {
  it('uses native kilometer readings and the 1,000-kilometer default when the window is missing', () => {
    const metric = {
      ...car,
      distanceUnit: 'kilometers',
      odometer: 19_000,
      reminderMiles: undefined,
    } as unknown as Car;
    const distanceOnly = { ...schedule, firstDueDate: null, intervalMonths: null };
    expect(getDueItem(distanceOnly, metric, [], '2026-09-25').status).toBe('upcoming');
    expect(getDueItem(distanceOnly, { ...metric, odometer: 18_999 }, [], '2026-09-25').status).toBe(
      'later',
    );
    expect(getDueItem(distanceOnly, { ...metric, odometer: 20_000 }, [], '2026-09-25').status).toBe(
      'due',
    );
    expect(dueDescription(getDueItem(distanceOnly, metric, [], '2026-09-25'))).toBe('at 20,000 km');
    expect(getDueItem(distanceOnly, { ...metric, reminderMiles: 0 }, [], '2026-09-25').status).toBe(
      'later',
    );
    expect(
      getDueItem(
        distanceOnly,
        { ...metric, reminderMiles: 1500, odometer: 18_500 },
        [],
        '2026-09-25',
      ).status,
    ).toBe('upcoming');
  });

  it('advances kilometer schedules from the completed kilometer reading without conversion', () => {
    const metric: Car = { ...car, distanceUnit: 'kilometers', reminderMiles: 1000 };
    const result = getDueItem(schedule, metric, [visit], '2026-09-26');
    expect(result.dueMiles).toBe(25_050);
    expect(result.milesRemaining).toBe(5000);
    expect(dueDescription(result)).toBe('by 2027-03-25 or at 25,050 km');
  });

  it('uses either date or mileage to mark work upcoming or due', () => {
    expect(getDueItem(schedule, car, [], '2026-09-25').status).toBe('upcoming');
    expect(getDueItem(schedule, { ...car, odometer: 20_000 }, [], '2026-09-25').status).toBe('due');
    expect(getDueItem(schedule, { ...car, odometer: 10_000 }, [], '2026-11-01').status).toBe('due');
  });

  it("uses a car's chosen upcoming window", () => {
    const narrow = { ...car, reminderDays: 7, reminderMiles: 100 };
    expect(getDueItem(schedule, narrow, [], '2026-09-25').status).toBe('later');
  });

  it('advances recurring work from the completed visit', () => {
    const result = getDueItem(schedule, car, [visit], '2026-09-26');
    expect(result.status).toBe('later');
    expect(result.dueMiles).toBe(25_050);
    expect(result.dueDate).toBe('2027-03-25');
    expect(latestOdometer(car, [visit])).toBe(20_050);
  });

  it('does not retain an old date after a mileage-only task is done', () => {
    const result = getDueItem({ ...schedule, intervalMonths: null }, car, [visit], '2026-11-20');
    expect(result.dueDate).toBeNull();
    expect(result.status).toBe('later');
  });

  it('keeps one-time completed work out of the due list', () => {
    const result = getDueItem(
      { ...schedule, intervalMonths: null, intervalMiles: null },
      car,
      [visit],
      '2027-01-01',
    );
    expect(result.status).toBe('completed');
  });

  it('does not invent due information for an unconfigured starter', () => {
    expect(
      getDueItem({ ...schedule, firstDueDate: null, firstDueMiles: null }, car, [], '2026-09-25')
        .status,
    ).toBe('setup');
  });

  it('handles month end dates', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
});

import { describe, expect, it } from 'vitest';
import { reportTotals, visitsToCsv } from './reports';
import type { Car, Visit } from './model';

const car: Car = {
  id: 'car',
  name: 'Daily, driver',
  year: 2020,
  make: 'Toyota',
  model: 'RAV4',
  vin: '',
  plate: '',
  distanceUnit: 'miles',
  odometer: 100,
  reminderDays: 30,
  reminderMiles: 500,
  createdAt: '2026-01-01T00:00:00Z',
};
const visit: Visit = {
  id: 'visit',
  carId: car.id,
  date: '2026-09-25',
  odometer: 100,
  totalCostCents: 15000,
  provider: 'Dealer',
  notes: 'Oil, tires\nchecked',
  items: [
    { id: 'a', name: 'Oil change', scheduleItemId: null, costCents: 8000 },
    { id: 'b', name: 'Tire rotation', scheduleItemId: null, costCents: null },
  ],
  photos: [],
  createdAt: '2026-09-25T00:00:00Z',
};

describe('reports and export', () => {
  it('keeps built-in categories and missing cars separate from identically named user entries', () => {
    const named = { ...car, name: 'Unknown car' };
    const categorized = {
      ...visit,
      items: [{ ...visit.items[0], name: 'Unallocated', costCents: 8000 }],
    };
    const result = reportTotals(
      [categorized, { ...visit, id: 'missing', carId: 'missing', items: [] }],
      [named],
    );
    expect(result.byCategory).toContainEqual({
      kind: 'category',
      name: 'Unallocated',
      amount: 8000,
    });
    expect(result.byCategory).toContainEqual({ kind: 'unallocated', name: null, amount: 22000 });
    expect(result.byCar).toEqual([
      { id: car.id, name: 'Unknown car', amount: 15000 },
      { id: 'missing', name: null, amount: 15000 },
    ]);
  });
  it('exports native numeric readings with per-row units for a mixed-unit garage', () => {
    const metric: Car = { ...car, id: 'metric', name: 'Metric car', distanceUnit: 'kilometers' };
    const csv = visitsToCsv(
      [visit, { ...visit, id: 'metric-visit', carId: metric.id, odometer: 160 }],
      [car, metric],
    );
    expect(csv).toContain('Date,Car,Odometer,Distance unit,Provider');
    expect(csv).toContain('"Daily, driver",100,mi,');
    expect(csv).toContain('Metric car,160,km,');
  });

  it('does not double-count a multi-item visit', () => {
    const result = reportTotals([visit], [car]);
    expect(result.totalCents).toBe(15000);
    expect(result.byCategory).toContainEqual({
      kind: 'category',
      name: 'Oil change',
      amount: 8000,
    });
    expect(result.byCategory).toContainEqual({ kind: 'unallocated', name: null, amount: 7000 });
  });

  it('exports quoted values and photo count in a spreadsheet-friendly CSV', () => {
    const csv = visitsToCsv([visit], [car]);
    expect(csv.startsWith('\uFEFFDate,Car,')).toBe(true);
    expect(csv).toContain('"Daily, driver"');
    expect(csv).toContain('"Oil, tires\nchecked"');
    expect(csv).toContain('150.00');
  });
});

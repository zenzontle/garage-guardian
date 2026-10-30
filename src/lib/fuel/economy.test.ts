import { describe, expect, it } from 'vitest';
import { car, fuelEntry } from '@/test/fixtures';
import { fuelEconomy } from './economy';
import { LITERS_PER_GALLON } from './fuel';
import type { FuelEntry } from '../garage/model';

let sequence = 0;
const fill = (odometer: number, volume: number, change: Partial<FuelEntry> = {}): FuelEntry => ({
  ...fuelEntry,
  id: `fill-${++sequence}`,
  date: `2026-09-${String(10 + sequence).padStart(2, '0')}`,
  odometer,
  volumeMilli: volume * 1000,
  ...change,
});

describe('fuel economy', () => {
  it('measures each full-to-full segment and averages over total distance and fuel', () => {
    const first = fill(1000, 10);
    const second = fill(1300, 10);
    const third = fill(1500, 10);
    const result = fuelEconomy(car, [third, first, second]);
    expect(result.unit).toBe('mpg');
    expect(result.byEntry.has(first.id)).toBe(false);
    expect(result.byEntry.get(second.id)).toBeCloseTo(30);
    expect(result.byEntry.get(third.id)).toBeCloseTo(20);
    expect(result.average).toBeCloseTo(25); // 500 mi / 20 gal, not the mean of 30 and 20
  });

  it('adds partial fills to the next full tank', () => {
    const start = fill(1000, 10);
    const partial = fill(1150, 4, { isFullTank: false });
    const full = fill(1400, 6);
    const result = fuelEconomy(car, [start, partial, full]);
    expect(result.byEntry.has(partial.id)).toBe(false);
    expect(result.byEntry.get(full.id)).toBeCloseTo(40); // 400 mi / (4 + 6) gal
  });

  it('ignores partial fills before the first full tank', () => {
    const result = fuelEconomy(car, [fill(900, 3, { isFullTank: false }), fill(1000, 10)]);
    expect(result.byEntry.size).toBe(0);
    expect(result.average).toBeNull();
  });

  it('skips a segment with a missed fill-up, then resumes from that full tank', () => {
    const start = fill(1000, 10);
    const missed = fill(1600, 10, { missedPrevious: true });
    const next = fill(1900, 10);
    const result = fuelEconomy(car, [start, missed, next]);
    expect(result.byEntry.has(missed.id)).toBe(false);
    expect(result.byEntry.get(next.id)).toBeCloseTo(30);
    expect(result.average).toBeCloseTo(30);
  });

  it('skips a segment when a partial fill in it was marked missed', () => {
    const start = fill(1000, 10);
    const partial = fill(1100, 5, { isFullTank: false, missedPrevious: true });
    const full = fill(1300, 5);
    expect(fuelEconomy(car, [start, partial, full]).byEntry.size).toBe(0);
  });

  it('skips zero-distance segments', () => {
    const result = fuelEconomy(car, [fill(1000, 10), fill(1000, 2)]);
    expect(result.byEntry.size).toBe(0);
    expect(result.average).toBeNull();
  });

  it('mixes gallons and liters for a miles car', () => {
    const start = fill(1000, 10);
    const liters = fill(1300, 37.854, { volumeUnit: 'liters' });
    expect(fuelEconomy(car, [start, liters]).byEntry.get(liters.id)).toBeCloseTo(
      300 / (37.854 / LITERS_PER_GALLON),
      6,
    );
  });

  it('shows liters per 100 km for a kilometer car', () => {
    const kmCar = { ...car, distanceUnit: 'kilometers' as const };
    const start = fill(40000, 40, { volumeUnit: 'liters' });
    const gallons = fill(40500, 10, { volumeUnit: 'gallons' });
    const result = fuelEconomy(kmCar, [start, gallons]);
    expect(result.unit).toBe('litersPer100Km');
    expect(result.byEntry.get(gallons.id)).toBeCloseTo((10 * LITERS_PER_GALLON * 100) / 500, 6);
  });

  it("only uses the car's own entries", () => {
    const result = fuelEconomy(car, [fill(1000, 10), fill(1300, 10, { carId: 'other' })]);
    expect(result.byEntry.size).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { car, fuelEntry } from '@/test/fixtures';
import {
  carStations,
  checkedFuelEntry,
  computeTotalCents,
  computeUnitPriceMilli,
  computeVolumeMilli,
  defaultVolumeUnit,
  formatMilli,
  fuelOdometerInOrder,
  lastFuelEntry,
  litersFromVolume,
  normalizeFuelEntry,
  parseMilli,
} from './fuel';
import type { FuelEntry } from '../garage/model';

describe('fuel amounts', () => {
  it('rounds volume × price to the nearest cent', () => {
    expect(computeTotalCents(12345, 3459)).toBe(4270); // 12.345 gal × $3.459 = $42.701
    expect(computeTotalCents(10000, 3459)).toBe(3459);
    expect(computeTotalCents(1000, 5)).toBe(1); // $0.005 rounds half up
    expect(computeTotalCents(1000, 4)).toBe(0);
    // The largest volume and an integer-limit price stay exact in double precision.
    expect(Number.isSafeInteger(2_000_000 * 2147483647)).toBe(true);
  });

  it('derives the unit price or volume from the other two amounts', () => {
    expect(computeUnitPriceMilli(4270, 12345)).toBe(3459);
    expect(computeUnitPriceMilli(1750, 5000)).toBe(3500);
    expect(computeUnitPriceMilli(100, 0)).toBeNull();
    expect(computeVolumeMilli(4270, 3459)).toBe(12345);
    expect(computeVolumeMilli(100, 0)).toBeNull();
    expect(computeVolumeMilli(0, 3459)).toBeNull();
  });

  it('parses up to three decimals without float drift', () => {
    expect(parseMilli('12.345')).toBe(12345);
    expect(parseMilli('3.4')).toBe(3400);
    expect(parseMilli(' 7 ')).toBe(7000);
    expect(parseMilli('0.1')).toBe(100);
    expect(parseMilli('1.2345')).toBeNull();
    expect(parseMilli('')).toBeNull();
    expect(parseMilli('-1')).toBeNull();
    expect(parseMilli('1e3')).toBeNull();
    expect(formatMilli(12345)).toBe('12.345');
    expect(formatMilli(3400)).toBe('3.4');
    expect(formatMilli(7000)).toBe('7');
  });

  it('converts US gallons to liters', () => {
    expect(litersFromVolume(1000, 'gallons')).toBeCloseTo(3.785411784, 9);
    expect(litersFromVolume(40000, 'liters')).toBe(40);
  });

  it("defaults the volume unit from the car's distance unit", () => {
    expect(defaultVolumeUnit(car)).toBe('gallons');
    expect(defaultVolumeUnit({ distanceUnit: 'kilometers' })).toBe('liters');
    expect(defaultVolumeUnit(undefined)).toBe('gallons');
  });
});

describe('fuel validation', () => {
  it('trims text and accepts a valid entry', () => {
    expect(checkedFuelEntry({ ...fuelEntry, station: '  Shell ', notes: ' ok ' })).toMatchObject({
      station: 'Shell',
      notes: 'ok',
    });
  });

  it.each<[string, Partial<FuelEntry>]>([
    ['zero volume', { volumeMilli: 0 }],
    ['oversized volume', { volumeMilli: 2_000_001 }],
    ['fractional thousandths', { volumeMilli: 1.5 }],
    ['negative odometer', { odometer: -1 }],
    ['negative price', { unitPriceMilli: -1 }],
    ['fractional cents', { totalCostCents: 1.5 }],
    ['unknown unit', { volumeUnit: 'pints' as never }],
    ['unknown fuel type', { fuelType: 'jet' as never }],
    ['unknown currency', { currency: 'EUR' as never }],
    ['invalid date', { date: '2026-02-30' }],
    ['long station', { station: 's'.repeat(101) }],
    ['long notes', { notes: 'n'.repeat(2001) }],
    ['four photos', { photos: Array(4).fill({ id: 'p', name: 'p', path: 'p', contentType: '' }) }],
  ])('rejects %s', (_, change) => {
    let failure: unknown;
    try {
      checkedFuelEntry({ ...fuelEntry, ...change });
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toMatchObject({ code: 'fuelFields' });
  });

  it('counts station length in Unicode characters like PostgreSQL', () => {
    expect(() => checkedFuelEntry({ ...fuelEntry, station: '⛽'.repeat(100) })).not.toThrow();
  });

  it('fills defaults for partial cached entries', () => {
    const legacy = { ...fuelEntry } as Partial<FuelEntry>;
    delete legacy.photos;
    delete legacy.station;
    delete legacy.missedPrevious;
    expect(normalizeFuelEntry(legacy as FuelEntry)).toMatchObject({
      photos: [],
      station: '',
      missedPrevious: false,
    });
  });
});

describe('fuel odometer order', () => {
  const earlier = { ...fuelEntry, id: 'earlier', date: '2026-09-01', odometer: 1000 };
  const later = { ...fuelEntry, id: 'later', date: '2026-10-01', odometer: 2000 };
  const entries = [earlier, later];

  it('accepts readings between earlier and later fill-ups', () => {
    expect(fuelOdometerInOrder({ ...fuelEntry, date: '2026-09-15', odometer: 1500 }, entries)).toBe(
      true,
    );
    expect(fuelOdometerInOrder({ ...fuelEntry, date: '2026-09-15', odometer: 1000 }, entries)).toBe(
      true,
    );
  });

  it('rejects a reading below an earlier fill-up or above a later one', () => {
    expect(fuelOdometerInOrder({ ...fuelEntry, date: '2026-09-15', odometer: 999 }, entries)).toBe(
      false,
    );
    expect(fuelOdometerInOrder({ ...fuelEntry, date: '2026-09-15', odometer: 2001 }, entries)).toBe(
      false,
    );
  });

  it('ignores same-day entries, other cars, and the entry being edited', () => {
    expect(fuelOdometerInOrder({ ...later, odometer: 500, date: '2026-09-01' }, entries)).toBe(
      true,
    );
    expect(
      fuelOdometerInOrder(
        { ...fuelEntry, carId: 'other', date: '2026-09-15', odometer: 1 },
        entries,
      ),
    ).toBe(true);
    expect(fuelOdometerInOrder({ ...later, odometer: 1500 }, entries)).toBe(true);
  });
});

describe('fuel defaults', () => {
  it('uses the newest entry and lists distinct stations newest first', () => {
    const entries = [
      { ...fuelEntry, id: 'a', date: '2026-09-01', station: 'Shell' },
      {
        ...fuelEntry,
        id: 'b',
        date: '2026-10-01',
        station: 'Costco',
        volumeUnit: 'liters' as const,
      },
      { ...fuelEntry, id: 'c', date: '2026-09-15', station: 'shell' },
      { ...fuelEntry, id: 'd', carId: 'other', date: '2026-12-01', station: 'Other' },
    ];
    expect(lastFuelEntry(car.id, entries)?.id).toBe('b');
    expect(lastFuelEntry('missing', entries)).toBeNull();
    expect(carStations(car.id, entries)).toEqual(['Costco', 'shell']);
  });
});

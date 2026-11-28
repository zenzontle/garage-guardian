import { describe, expect, it } from 'vitest';
import { car, expense, fuelEntry, schedule, visit } from '@/test/fixtures';
import { EMPTY_SNAPSHOT, type Car, type Snapshot } from '../garage/model';
import { expensesToCsv, fuelToCsv, visitsToCsv } from '../reports/reports';
import { parseCsv } from './csv-parse';
import {
  autoMap,
  buildImportPreview,
  detectDateOrder,
  MAX_IMPORT_ROWS,
  normalizeHeader,
  parseImportDate,
  plainDecimal,
  recordsToImport,
  type ImportKind,
  type ImportPreview,
  type ImportOptions,
} from './import';

const today = '2026-10-13';
let counter = 0;
const options = (change: Partial<ImportOptions> = {}): ImportOptions => ({
  carId: null,
  currency: 'USD',
  dateOrder: 'mdy',
  today,
  now: Date.parse('2026-10-13T12:00:00.000Z'),
  newId: () => `id-${++counter}`,
  ...change,
});
const garage = (change: Partial<Snapshot> = {}): Snapshot => ({
  ...EMPTY_SNAPSHOT,
  cars: [car],
  schedules: [schedule],
  ...change,
});

function preview<K extends ImportKind>(
  kind: K,
  csv: string,
  snapshot = garage(),
  change: Partial<ImportOptions> = {},
) {
  const table = parseCsv(csv);
  return buildImportPreview(kind, table, autoMap(kind, table[0]), snapshot, options(change));
}
const issueCodes = (result: ImportPreview<unknown>) =>
  result.rows.map((row) => row.issues.map((issue) => issue.code));

describe('autoMap', () => {
  it('maps the export headers of every kind', () => {
    const headers = parseCsv(fuelToCsv([fuelEntry], [car]))[0];
    expect(autoMap('fuel', headers)).toMatchObject({
      date: 0,
      car: 1,
      odometer: 2,
      distanceUnit: 3,
      volume: 4,
      volumeUnit: 5,
      fuelType: 6,
      unitPrice: 7,
      total: 8,
      fullTank: 9,
      missedPrevious: 10,
      station: 13,
      notes: 14,
      currency: 16,
    });
    expect(autoMap('visit', parseCsv(visitsToCsv([visit], [car]))[0])).toMatchObject({
      items: 5,
      total: 6,
      itemCosts: 7,
    });
  });

  it('maps Spanish and accented headers, and never maps one column twice', () => {
    const mapping = autoMap('expense', ['Fecha', 'Vehículo', 'Categoría', 'Monto', 'Moneda']);
    expect(mapping).toEqual({ date: 0, car: 1, category: 2, total: 3, currency: 4 });
    // "Price" is the fill-up unit price, and only the total when nothing else claims it.
    expect(autoMap('fuel', ['Price', 'Total'])).toEqual({ unitPrice: 0, total: 1 });
    expect(autoMap('expense', ['Price'])).toEqual({ total: 0 });
  });

  it('normalizes headers without accents or punctuation', () => {
    expect(normalizeHeader('  Odómetro (MI) ')).toBe('odometro mi');
  });
});

describe('dates and numbers', () => {
  it.each([
    ['2026-03-04', 'mdy', '2026-03-04'],
    ['2026/3/4', 'dmy', '2026-03-04'],
    ['2026-03-04T23:30:00-06:00', 'mdy', '2026-03-04'],
    ['3/4/2026', 'mdy', '2026-03-04'],
    ['3/4/2026', 'dmy', '2026-04-03'],
    ['04.03.2026', 'dmy', '2026-03-04'],
    ['3/4/2026', 'ymd', null],
    ['2/30/2026', 'mdy', null],
    ['3/4/26', 'mdy', null],
    ['yesterday', 'mdy', null],
  ] as const)('reads %s as %s order', (value, order, expected) => {
    expect(parseImportDate(value, order)).toBe(expected);
  });

  it('detects the day-month order from a day above 12', () => {
    expect(detectDateOrder(['1/2/2026', '25/2/2026'])).toBe('dmy');
    expect(detectDateOrder(['2/25/2026'])).toBe('mdy');
    expect(detectDateOrder(['1/2/2026', '2026-05-30'])).toBeNull();
  });

  it.each([
    ['$1,234.50', '1234.50'],
    ['MX$ 99', '99'],
    ['12.5 USD', '12.5'],
    ['.5', '0.5'],
    ['1,5', null],
    ['-3', null],
    ['12,34', null],
  ])('reads %s as a plain decimal', (value, expected) => {
    expect(plainDecimal(value)).toBe(expected);
  });
});

describe('export round trip', () => {
  // A second garage whose vehicle has the same name, as on another device or a new account.
  const other: Car = { ...car, id: 'other-car' };
  const strip = (record: { id: string; carId: string; createdAt: string }) => ({
    ...record,
    id: undefined,
    carId: undefined,
    createdAt: undefined,
  });

  it('imports exported service visits with their items, costs, and completed tasks', () => {
    const visits = [
      visit,
      {
        ...visit,
        id: 'second',
        date: '2026-09-30',
        odometer: null,
        provider: '=Shop, "Main" st.',
        notes: 'Two\nlines',
        totalCostCents: 9000,
        currency: 'MXN' as const,
        items: [
          { id: 'a', name: 'Wipers', scheduleItemId: null, costCents: 2500 },
          { id: 'b', name: 'Inspection', scheduleItemId: null, costCents: null },
        ],
      },
    ];
    const result = preview(
      'visit',
      visitsToCsv(visits, [car]),
      garage({ cars: [other], schedules: [{ ...schedule, carId: other.id }] }),
    );
    expect(result).toMatchObject({ ready: 2, errors: 0, duplicates: 0 });
    const records = recordsToImport(result, false);
    expect(records.map((record) => record.carId)).toEqual([other.id, other.id]);
    expect(records.map(strip)).toEqual(
      visits.map((entry) => ({
        ...strip(entry),
        items: entry.items.map((item) => ({ ...item, id: expect.any(String) })),
      })),
    );
  });

  it('imports exported fill-ups and other costs unchanged', () => {
    const entries = [
      fuelEntry,
      { ...fuelEntry, id: 'next', date: '2026-10-01', odometer: 700, station: '', notes: 'x' },
    ];
    const fuel = preview('fuel', fuelToCsv(entries, [car]), garage({ cars: [other] }));
    expect(fuel).toMatchObject({ ready: 2, errors: 0 });
    expect(recordsToImport(fuel, false).map(strip)).toEqual(entries.map(strip));

    const costs = [expense, { ...expense, id: 'tax', category: 'tax' as const, renewsOn: null }];
    const result = preview('expense', expensesToCsv(costs, [car]), garage({ cars: [other] }));
    expect(result).toMatchObject({ ready: 2, errors: 0 });
    expect(recordsToImport(result, false).map(strip)).toEqual(costs.map(strip));
  });

  it('marks records that are already saved as duplicates', () => {
    const csv = fuelToCsv([fuelEntry], [car]);
    const result = preview('fuel', csv, garage({ fuelEntries: [fuelEntry] }));
    expect(result).toMatchObject({ ready: 0, duplicates: 1 });
    expect(recordsToImport(result, false)).toEqual([]);
    expect(recordsToImport(result, true)).toHaveLength(1);
  });
});

describe('buildImportPreview', () => {
  it('marks repeated rows in one file as duplicates after the first', () => {
    const csv =
      'Date,Car,Category,Amount\n2026-09-01,Daily driver,Insurance,420\n9/1/2026,daily  DRIVER,insurance,420.00';
    expect(preview('expense', csv).rows.map((row) => row.status)).toEqual(['ready', 'duplicate']);
  });

  it('uses the chosen vehicle and default currency for every row', () => {
    const result = preview('expense', 'Date,Type,Cost\n2026-09-01,Seguro,10', garage(), {
      carId: car.id,
      currency: 'MXN',
    });
    expect(recordsToImport(result, false)[0]).toMatchObject({
      carId: car.id,
      category: 'insurance',
      currency: 'MXN',
      totalCostCents: 1000,
    });
  });

  it('reports rows that cannot be imported, with their file line', () => {
    const csv = [
      'Date,Car,Category,Amount,Currency,Renews on',
      ',Daily driver,Insurance,10,USD,',
      '2026-10-14,Daily driver,Insurance,10,USD,',
      '2026-09-01,Weekend car,Insurance,10,USD,',
      '2026-09-01,Daily driver,,10.999,EUR,2026-08-01',
    ].join('\n');
    const result = preview('expense', csv);
    expect(result.rows.map((row) => row.line)).toEqual([2, 3, 4, 5]);
    expect(result.errors).toBe(4);
    expect(issueCodes(result)).toEqual([
      ['missingDate'],
      ['futureDate'],
      ['unknownCar'],
      ['missingCategory', 'invalidAmount', 'invalidCurrency', 'invalidRenewal'],
    ]);
  });

  it('keeps an unknown category as Other, with the category as its description', () => {
    const result = preview(
      'expense',
      'Date,Car,Category,Amount\n2026-09-01,Daily driver,Roadside,5',
    );
    expect(result.rows[0]).toMatchObject({
      status: 'ready',
      issues: [{ code: 'unknownCategory', values: { value: 'Roadside' } }],
      record: { category: 'other', description: 'Roadside' },
    });
  });

  it('requires a vehicle column or a chosen vehicle', () => {
    expect(issueCodes(preview('expense', 'Date,Category,Amount\n2026-09-01,Tolls,5'))).toEqual([
      ['missingCar'],
    ]);
  });

  it('prefers an active vehicle over an archived one with the same name', () => {
    const archived = { ...car, id: 'archived', isArchived: true };
    const result = preview(
      'expense',
      'Date,Car,Category,Amount\n2026-09-01,Daily driver,Tolls,5',
      garage({ cars: [archived, car] }),
    );
    expect(result.rows[0].record?.carId).toBe(car.id);
  });

  describe('fill-ups', () => {
    const header = 'Date,Car,Odometer,Distance unit,Volume,Volume unit,Price per unit,Total';

    it('computes the missing total or unit price, and defaults the volume unit', () => {
      const km = { ...car, distanceUnit: 'kilometers' as const };
      const result = preview(
        'fuel',
        [
          'Date,Car,Odometer,Liters,Price,Total',
          '2026-09-01,Daily driver,"1,200",40,24.5,',
          '2026-09-02,Daily driver,1300,40,,980',
        ].join('\n'),
        garage({ cars: [km] }),
      );
      expect(recordsToImport(result, false)).toMatchObject([
        { volumeUnit: 'liters', volumeMilli: 40000, unitPriceMilli: 24500, totalCostCents: 98000 },
        { volumeUnit: 'liters', unitPriceMilli: 24500, totalCostCents: 98000, fuelType: 'other' },
      ]);
    });

    it('rejects odometers out of order with saved and imported fill-ups', () => {
      const result = preview(
        'fuel',
        [
          header,
          '2026-09-20,Daily driver,450,mi,10,gal,3,',
          '2026-09-28,Daily driver,390,mi,10,gal,3,',
          '2026-10-02,Daily driver,900,mi,10,gal,3,',
          '2026-10-05,Daily driver,800,mi,10,gal,3,',
        ].join('\n'),
        garage({ fuelEntries: [fuelEntry] }),
      );
      // The saved fill-up is 400 on 2026-09-26.
      expect(result.rows.map((row) => row.status)).toEqual(['error', 'error', 'error', 'error']);
      expect(issueCodes(result).flat()).toEqual(Array(4).fill('odometerOrder'));
    });

    it('rejects a distance unit that differs from the vehicle and unreadable values', () => {
      const result = preview(
        'fuel',
        [
          header + ',Gas type,Full tank',
          '2026-09-01,Daily driver,100,km,10,gal,3,,regular,yes',
          '2026-09-01,Daily driver,10.5,mi,0,cups,abc,,rocket fuel,maybe',
          '2026-09-01,Daily driver,,mi,,gal,,,,',
        ].join('\n'),
      );
      expect(issueCodes(result)).toEqual([
        ['distanceUnitMismatch'],
        [
          'invalidOdometer',
          'invalidVolume',
          'invalidVolumeUnit',
          'invalidUnitPrice',
          'unknownFuelType',
          'invalidFlag',
        ],
        ['missingOdometer', 'missingVolume', 'missingFuelPrice'],
      ]);
    });

    it('imports an unknown gas type as Other with a warning', () => {
      const result = preview(
        'fuel',
        `${header},Gas type\n2026-09-01,Daily driver,100,mi,10,gal,3,,Magna Sin`,
      );
      expect(result.rows[0]).toMatchObject({
        status: 'ready',
        issues: [{ code: 'unknownFuelType' }],
        record: { fuelType: 'other' },
      });
    });
  });

  describe('service visits', () => {
    it('links items to the vehicle’s active tasks by name and reads item costs', () => {
      const result = preview(
        'visit',
        'Date,Car,Services,Item costs,Total\n2026-09-01,Daily driver,OIL CHANGE; Wipers,oil change: 40; Wipers: 10,60',
      );
      expect(recordsToImport(result, false)[0]).toMatchObject({
        odometer: null,
        totalCostCents: 6000,
        items: [
          { name: 'OIL CHANGE', scheduleItemId: schedule.id, costCents: 4000 },
          { name: 'Wipers', scheduleItemId: null, costCents: 1000 },
        ],
      });
    });

    it('does not link items to inactive tasks', () => {
      const result = preview(
        'visit',
        'Date,Car,Services\n2026-09-01,Daily driver,Oil change',
        garage({ schedules: [{ ...schedule, isActive: false }] }),
      );
      expect(recordsToImport(result, false)[0].items[0].scheduleItemId).toBeNull();
    });

    it('rejects visits without items, unmatched item costs, and items over the total', () => {
      const result = preview(
        'visit',
        [
          'Date,Car,Services,Item costs,Total',
          '2026-09-01,Daily driver,,,10',
          '2026-09-01,Daily driver,Wipers,Brakes: 5,10',
          '2026-09-01,Daily driver,Wipers,Wipers: 20,10',
        ].join('\n'),
      );
      expect(issueCodes(result)).toEqual([
        ['missingItems'],
        ['invalidItemCosts'],
        ['itemCostsTooHigh'],
      ]);
    });

    it('rejects text longer than the saved limits', () => {
      const result = preview(
        'visit',
        `Date,Car,Services,Provider\n2026-09-01,Daily driver,Wipers,${'x'.repeat(101)}`,
      );
      expect(result.rows[0].issues).toEqual([
        { code: 'textTooLong', values: { field: 'provider', max: 100 } },
      ]);
    });
  });

  it('reads at most the row limit and counts the rest as skipped', () => {
    const rows = Array.from(
      { length: MAX_IMPORT_ROWS + 3 },
      () => '2026-09-01,Daily driver,Tolls,1',
    );
    const result = preview('expense', ['Date,Car,Category,Amount', ...rows].join('\n'));
    expect(result.rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(result.skipped).toBe(3);
  });

  it('keeps the file order in the creation times', () => {
    const result = preview(
      'expense',
      'Date,Car,Category,Amount\n2026-09-01,Daily driver,Tolls,1\n2026-09-01,Daily driver,Tolls,2',
    );
    const [first, second] = recordsToImport(result, false);
    expect(first.createdAt < second.createdAt).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { car, expense, fuelEntry, visit } from '@/test/fixtures';
import { automaticConversion } from '../currency/currency';
import { distanceDriven, expensesToCsv, fuelToCsv, reportTotals } from './reports';

const kmCar = { ...car, id: 'km', name: 'Metric', distanceUnit: 'kilometers' as const };

describe('reportTotals with fuel and other costs', () => {
  it('adds fill-ups and costs to totals, months, vehicles, and types', () => {
    const totals = reportTotals([visit], [car], 'USD', [fuelEntry], [expense]);
    expect(totals.totalCents).toBe(15000 + 3459 + 42000);
    expect(totals.serviceCents).toBe(15000);
    expect(totals.convertedCount).toBe(1);
    expect(totals.byCar).toEqual([{ id: car.id, name: car.name, amount: 60459 }]);
    expect(totals.byMonth).toEqual([['2026-09', 60459]]);
    expect(totals.byType).toEqual([
      { kind: 'expense', category: 'insurance', amount: 42000 },
      { kind: 'service', category: null, amount: 15000 },
      { kind: 'fuel', category: null, amount: 3459 },
    ]);
  });

  it('counts unconverted fill-ups and costs as pending, and uses saved conversions', () => {
    const peso = { ...fuelEntry, currency: 'MXN' as const, totalCostCents: 100000 };
    const pending = reportTotals([], [car], 'USD', [peso], [{ ...expense, currency: 'CAD' }]);
    expect(pending).toMatchObject({ totalCents: 0, pendingCount: 2 });
    const usd = automaticConversion(
      { currency: 'MXN', date: peso.date, totalCostCents: 100000 },
      { rate: 0.05, rateDate: peso.date },
    );
    expect(
      reportTotals([], [car], 'USD', [{ ...peso, conversions: { USD: usd } }]).totalCents,
    ).toBe(5000);
  });
});

describe('distanceDriven', () => {
  it('sums each car’s highest minus lowest dated reading', () => {
    expect(
      distanceDriven([car], [{ ...visit, odometer: 100 }], [{ ...fuelEntry, odometer: 400 }]),
    ).toEqual({ unit: 'miles', distance: 300, carIds: [car.id] });
  });

  it('needs two different readings and refuses to add miles to kilometers', () => {
    expect(distanceDriven([car], [visit], [])).toBeNull();
    expect(distanceDriven([car], [{ ...visit, odometer: null }], [fuelEntry])).toBeNull();
    expect(
      distanceDriven(
        [car, kmCar],
        [visit, { ...visit, id: 'k1', carId: kmCar.id, odometer: 10 }],
        [fuelEntry, { ...fuelEntry, id: 'k2', carId: kmCar.id, odometer: 900 }],
      ),
    ).toBe('mixed');
  });
});

describe('CSV exports', () => {
  it('exports fill-ups with economy and home-currency columns', () => {
    const csv = fuelToCsv([fuelEntry], [car], 'USD', () => 31.25);
    const [headers, row] = csv.replace('﻿', '').trim().split('\r\n');
    expect(headers.split(',')).toContain('Economy');
    expect(row).toBe(
      '2026-09-26,Daily driver,400,mi,10,gal,regular,3.459,34.59,yes,no,31.25,mpg,Corner station,,0,USD,USD,34.59,same-currency,',
    );
  });

  it('exports other costs and neutralizes spreadsheet formulas', () => {
    const csv = expensesToCsv([{ ...expense, description: '=HYPERLINK()' }], [car], 'USD');
    expect(csv.trim().split('\r\n')[1]).toBe(
      "2026-09-01,Daily driver,insurance,'=HYPERLINK(),420.00,2027-03-01,,USD,USD,420.00,same-currency,",
    );
  });
});

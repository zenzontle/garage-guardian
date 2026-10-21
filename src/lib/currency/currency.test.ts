import { describe, expect, it } from 'vitest';
import { visit, car } from '@/test/fixtures';
import { normalizeSnapshot } from '../garage/model';
import { reportTotals, visitsToCsv } from '../reports/reports';
import {
  allocateConverted,
  automaticConversion,
  CURRENCIES,
  compareCost,
  convertCents,
  MAX_CENTS,
  normalizeVisit,
  parseCents,
  receiptInputs,
  reportingCents,
  validDate,
  type Currency,
} from './currency';

describe('receipt currencies', () => {
  it.each(CURRENCIES.flatMap((base) => CURRENCIES.map((target) => [base, target] as const)))(
    'reports %s in %s without changing originals',
    (base, target) => {
      const original = { ...visit, currency: base };
      const inputs = receiptInputs(original);
      const conversion = automaticConversion(inputs, { rate: 1.25, rateDate: original.date });
      const saved = { ...original, conversions: { [target]: conversion } };
      expect(reportingCents(saved, target)).toBe(base === target ? visit.totalCostCents : 18750);
      expect(saved.totalCostCents).toBe(visit.totalCostCents);
    },
  );
  it('normalizes legacy snapshots without changing USD totals', () => {
    const legacy = { ...visit };
    delete legacy.currency;
    delete legacy.conversions;
    const saved = normalizeSnapshot({ cars: [car], visits: [legacy], schedules: [] });
    expect(saved.homeCurrency).toBe('USD');
    expect(saved.visits[0]).toMatchObject({
      currency: 'USD',
      conversions: {},
      totalCostCents: 15000,
    });
    expect(reportTotals(saved.visits, saved.cars).totalCents).toBe(15000);
  });
  it.each(['-1', 'NaN', 'Infinity', '1.001', '1e6', String(MAX_CENTS), 'no'])(
    'rejects invalid money %s',
    (input) => expect(parseCents(input)).toBeNull(),
  );
  it.each(['', '0', '0.00'])('accepts zero costs %s', (input) => expect(parseCents(input)).toBe(0));
  it('rounds decimal rates exactly, including half cents and scientific notation', () => {
    expect(convertCents(100, 1.005)).toBe(101);
    expect(convertCents(15000, 1e-7)).toBe(0);
    expect(convertCents(1, 1e3)).toBe(1000);
  });
  it('rejects invalid dates and future effective dates', () => {
    expect(validDate('2024-02-30')).toBe(false);
    expect(validDate('2024-02-29')).toBe(true);
    expect(() =>
      automaticConversion(receiptInputs(visit), { rate: 2, rateDate: '2026-09-26' }),
    ).toThrow();
  });
  it('freezes manual overrides per target and invalidates changed inputs', () => {
    const original = { ...visit, currency: 'MXN' as Currency };
    const manual = {
      ...receiptInputs(original),
      convertedCents: 789,
      source: 'manual' as const,
      rate: null,
      rateDate: null,
    };
    const saved = {
      ...original,
      conversions: { USD: manual, CAD: { ...manual, convertedCents: 1011 } },
    };
    expect(reportingCents(saved, 'USD')).toBe(789);
    expect(reportingCents(saved, 'CAD')).toBe(1011);
    expect(reportingCents(saved, 'MXN')).toBe(15000);
    expect(reportingCents(saved, 'USD')).toBe(789);
    expect(normalizeVisit({ ...saved, notes: 'Changed' }).conversions).toEqual(saved.conversions);
    for (const edited of [
      { totalCostCents: 15100 },
      { date: '2026-09-24' },
      { currency: 'CAD' as Currency },
    ]) {
      expect(normalizeVisit({ ...saved, ...edited }).conversions).toEqual({});
    }
  });
  it('allocates rounding cents deterministically across items and remainder', () => {
    const original = {
      ...visit,
      totalCostCents: 3,
      items: [
        { ...visit.items[0], id: 'a', costCents: 1 },
        { ...visit.items[0], id: 'b', name: 'Second', costCents: 1 },
      ],
    };
    expect(allocateConverted(original, 2)).toEqual([1, 1, 0]);
    expect(allocateConverted(original, 1)).toEqual([1, 0, 0]);
    expect(allocateConverted({ ...original, totalCostCents: 0, items: [] }, 9)).toEqual([9]);
    for (let total = 0; total < 100; total++)
      expect(allocateConverted(original, total).reduce((a, b) => a + b, 0)).toBe(total);
    const conversion = automaticConversion(receiptInputs(original), {
      rate: 0.5,
      rateDate: original.date,
    });
    const totals = reportTotals(
      [{ ...original, currency: 'USD', conversions: { CAD: conversion } }],
      [car],
      'CAD',
    );
    expect(totals.byCategory.reduce((sum, item) => sum + item.amount, 0)).toBe(totals.totalCents);
  });
  it('excludes pending conversions and places them last in both cost directions', () => {
    const pending = { ...visit, id: 'pending', currency: 'MXN' as Currency };
    const zero = { ...visit, id: 'zero', totalCostCents: 0, items: [] };
    const totals = reportTotals([visit, pending, zero], [car]);
    expect(totals).toMatchObject({ totalCents: 15000, pendingCount: 1, convertedCount: 2 });
    expect(
      [pending, visit, zero].sort((a, b) => compareCost(a, b, 'USD', false)).map((v) => v.id),
    ).toEqual(['zero', visit.id, 'pending']);
    expect(
      [pending, visit, zero].sort((a, b) => compareCost(a, b, 'USD', true)).map((v) => v.id),
    ).toEqual([visit.id, 'zero', 'pending']);
  });
  it('exports canonical currency and conversion columns with blank pending amounts', () => {
    const foreign = { ...visit, currency: 'MXN' as Currency };
    const conversion = automaticConversion(receiptInputs(foreign), {
      rate: 0.05,
      rateDate: '2026-09-24',
    });
    const csv = visitsToCsv([{ ...foreign, conversions: { USD: conversion } }, foreign], [car]);
    expect(csv).toContain(
      'Original currency,Reporting currency,Converted total,Conversion source,Rate date',
    );
    expect(csv).toContain('MXN,USD,7.50,automatic,2026-09-24');
    expect(csv).toContain('MXN,USD,,,\r\n');
  });
});

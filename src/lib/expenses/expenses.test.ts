import { describe, expect, it } from 'vitest';
import { car, expense } from '@/test/fixtures';
import { automaticConversion } from '../currency/currency';
import { checkedExpense, getRenewals, normalizeExpense } from './expenses';

const today = '2026-10-13';

describe('checkedExpense', () => {
  it('trims text and keeps a valid cost', () => {
    expect(checkedExpense({ ...expense, description: '  Policy  ', notes: ' n ' })).toMatchObject({
      description: 'Policy',
      notes: 'n',
    });
  });

  it.each([
    ['a renewal on the cost date', { renewsOn: expense.date }],
    ['a renewal before the cost date', { renewsOn: '2026-08-01' }],
    ['an invalid date', { date: '2026-02-30' }],
    ['an unknown category', { category: 'fuel' as never }],
    ['negative cents', { totalCostCents: -1 }],
    ['an unsupported currency', { currency: 'EUR' as never }],
    ['a long description', { description: 'x'.repeat(101) }],
  ])('rejects %s', (_, change) => {
    expect(() => checkedExpense({ ...expense, ...change })).toThrow();
  });

  it('keeps automatic conversions that match the cost and drops stale or manual ones', () => {
    const inputs = { currency: 'MXN' as const, date: expense.date, totalCostCents: 100000 };
    const usd = automaticConversion(inputs, { rate: 0.05, rateDate: expense.date });
    const checked = checkedExpense({
      ...expense,
      ...inputs,
      conversions: {
        USD: usd,
        CAD: {
          ...usd,
          currency: 'MXN',
          convertedCents: 1,
          source: 'manual',
          rate: null,
          rateDate: null,
        },
      },
    });
    expect(checked.conversions).toEqual({ USD: usd });
    expect(
      checkedExpense({ ...expense, ...inputs, totalCostCents: 5, conversions: { USD: usd } })
        .conversions,
    ).toEqual({});
  });

  it('normalizes legacy fields', () => {
    expect(
      normalizeExpense({ ...expense, renewsOn: undefined as never, currency: undefined as never }),
    ).toMatchObject({ renewsOn: null, currency: 'USD', conversions: {} });
  });
});

describe('getRenewals', () => {
  it('uses the latest renewal per vehicle and category, within the vehicle window', () => {
    const renewals = getRenewals(
      [car],
      [
        expense,
        { ...expense, id: 'next', date: '2027-03-01', renewsOn: '2027-09-01' },
        { ...expense, id: 'plate', category: 'registration', renewsOn: '2026-10-30' },
        { ...expense, id: 'paid', category: 'tolls', renewsOn: null },
        { ...expense, id: 'late', category: 'inspection', renewsOn: '2026-10-13' },
      ],
      today,
    );
    expect(renewals.map(({ expense, status }) => [expense.id, status])).toEqual([
      ['late', 'due'],
      ['plate', 'upcoming'],
      ['next', 'later'],
    ]);
  });

  it('settles a renewal when the next payment is logged, even without a new renewal date', () => {
    const due = { ...expense, renewsOn: '2026-10-01' };
    expect(getRenewals([car], [due], today)).toHaveLength(1);
    const paid = { ...expense, id: 'paid', date: '2026-10-05', renewsOn: null };
    expect(getRenewals([car], [due, paid], today)).toEqual([]);
  });

  it('keeps recurring costs apart from other costs in the same category', () => {
    const due = { ...expense, renewsOn: '2026-10-01' };
    const oneOff = { ...expense, id: 'wipers', date: '2026-10-05', description: 'Wiper blades' };
    expect(getRenewals([car], [due, { ...oneOff, renewsOn: null }], today)).toHaveLength(1);
    // Case and spacing don't make a different cost.
    const paid = { ...oneOff, id: 'paid', description: ` ${due.description.toUpperCase()}  ` };
    expect(getRenewals([car], [due, { ...paid, renewsOn: null }], today)).toEqual([]);
  });

  it('skips archived and deleted vehicles', () => {
    expect(getRenewals([{ ...car, isArchived: true }], [expense], today)).toEqual([]);
    expect(getRenewals([], [expense], today)).toEqual([]);
  });
});

import type { Visit } from '../garage/model';

export const CURRENCIES = ['USD', 'MXN', 'CAD'] as const;
export type Currency = (typeof CURRENCIES)[number];
export type ReceiptInputs = { currency: Currency; date: string; totalCostCents: number };
export type Conversion = ReceiptInputs & {
  convertedCents: number;
  source: 'automatic' | 'manual';
  rate: number | null;
  rateDate: string | null;
};
export type Conversions = Partial<Record<Currency, Conversion>>;
export type Rate = { rate: number; rateDate: string };
export const MAX_CENTS = 2147483647;
export const isCurrency = (value: unknown): value is Currency =>
  CURRENCIES.some((currency) => currency === value);
export const currencyOrDefault = (value: unknown): Currency => (isCurrency(value) ? value : 'USD');
export const validCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_CENTS;
export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function parseCents(value: string): number | null {
  if (value.trim() === '') return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(value)) return null;
  const cents = Math.round(Number(value) * 100);
  return validCents(cents) ? cents : null;
}
export const receiptInputs = (
  visit: Pick<Visit, 'currency' | 'date' | 'totalCostCents'>,
): ReceiptInputs => ({
  currency: currencyOrDefault(visit.currency),
  date: visit.date,
  totalCostCents: visit.totalCostCents,
});
export const sameInputs = (a: ReceiptInputs, b: ReceiptInputs) =>
  a.currency === b.currency && a.date === b.date && a.totalCostCents === b.totalCostCents;
export function convertCents(cents: number, rate: number): number {
  if (!validCents(cents) || !Number.isFinite(rate) || rate <= 0)
    throw new Error('Invalid conversion');
  const [coefficient, exponent = '0'] = rate.toString().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const scale = fraction.length - Number(exponent);
  const numerator =
    BigInt(whole + fraction) * BigInt(cents) * BigInt(10) ** BigInt(Math.max(0, -scale));
  const denominator = BigInt(10) ** BigInt(Math.max(0, scale));
  return Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));
}
export function validConversion(value: unknown, inputs: ReceiptInputs): value is Conversion {
  if (!value || typeof value !== 'object') return false;
  const c = value as Conversion;
  return (
    sameInputs(c, inputs) &&
    validCents(c.convertedCents) &&
    (c.source === 'manual'
      ? c.rate === null && c.rateDate === null
      : c.source === 'automatic' &&
        typeof c.rate === 'number' &&
        Number.isFinite(c.rate) &&
        c.rate > 0 &&
        validDate(c.rateDate) &&
        c.rateDate <= inputs.date &&
        convertCents(inputs.totalCostCents, c.rate) === c.convertedCents)
  );
}
export function normalizeVisit(visit: Visit): Visit {
  const inputs = receiptInputs(visit);
  const conversions: Conversions = {};
  for (const target of CURRENCIES) {
    const value = visit.conversions?.[target];
    if (target !== inputs.currency && validConversion(value, inputs)) conversions[target] = value;
  }
  return { ...visit, currency: inputs.currency, conversions };
}
export function mergeConversions(saved: Conversions = {}, incoming: Conversions = {}): Conversions {
  const result = { ...saved };
  for (const target of CURRENCIES) {
    const conversion = incoming[target];
    if (conversion && (!result[target] || conversion.source === 'manual'))
      result[target] = conversion;
  }
  return result;
}
export function reportingCents(visit: Visit, target: Currency): number | null {
  const inputs = receiptInputs(visit);
  if (inputs.currency === target) return inputs.totalCostCents;
  const conversion = visit.conversions?.[target];
  return validConversion(conversion, inputs) ? conversion.convertedCents : null;
}
export function automaticConversion(inputs: ReceiptInputs, rate: Rate): Conversion {
  const conversion: Conversion = {
    ...inputs,
    ...rate,
    source: 'automatic',
    convertedCents: convertCents(inputs.totalCostCents, rate.rate),
  };
  if (!validConversion(conversion, inputs)) throw new Error('Invalid conversion');
  return conversion;
}
export function compareCost(a: Visit, b: Visit, target: Currency, descending: boolean) {
  const left = reportingCents(a, target),
    right = reportingCents(b, target);
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return descending ? right - left : left - right;
}

// Largest remainders, with receipt order as the tie breaker (unallocated last).
// BigInt keeps cent allocation exact even at the database's maximum receipt size.
export function allocateConverted(visit: Visit, total: number): number[] {
  const weights = visit.items.map((item) => Math.max(0, item.costCents ?? 0));
  weights.push(Math.max(0, visit.totalCostCents - weights.reduce((sum, cost) => sum + cost, 0)));
  const denominator = weights.reduce((sum, cost) => sum + cost, 0);
  if (!denominator) return weights.map((_, index) => (index === weights.length - 1 ? total : 0));
  const products = weights.map((weight) => BigInt(weight) * BigInt(total));
  const amounts = products.map((product) => Number(product / BigInt(denominator)));
  const order = products
    .map((product, index) => ({ index, remainder: product % BigInt(denominator) }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  const remaining = total - amounts.reduce((sum, amount) => sum + amount, 0);
  for (let i = 0; i < remaining; i++) amounts[order[i].index]++;
  return amounts;
}

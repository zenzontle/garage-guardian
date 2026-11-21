import {
  distanceAbbreviation,
  type Car,
  type DistanceUnit,
  type Expense,
  type ExpenseCategory,
  type FuelEntry,
  type Visit,
} from '../garage/model';
import { formatMilli } from '../fuel/fuel';
import { EXPENSE_CATEGORIES } from '../expenses/expenses';
import {
  allocateConverted,
  centsToInput,
  currencyOrDefault,
  reportingCents,
  type Currency,
  type Receipt,
} from '../currency/currency';

export type SpendingType =
  | { kind: 'service'; category: null; amount: number }
  | { kind: 'fuel'; category: null; amount: number }
  | { kind: 'expense'; category: ExpenseCategory; amount: number };

/**
 * Home-currency spending across service visits, fill-ups, and other costs. Receipts without a
 * conversion are excluded and counted as pending. Service categories and averages cover visits.
 */
export function reportTotals(
  visits: Visit[],
  cars: Car[],
  homeCurrency: Currency = 'USD',
  fuelEntries: FuelEntry[] = [],
  expenses: Expense[] = [],
) {
  const byMonth = new Map<string, number>();
  const byCar = new Map<string, number>();
  const byCategory = new Map<string, number>();
  let unallocatedCents = 0;
  let totalCents = 0;
  let pendingCount = 0;
  let visitPendingCount = 0;
  let serviceCents = 0;
  let fuelCents = 0;
  const expenseCents = new Map<ExpenseCategory, number>();
  const count = (receipt: Receipt & { carId: string }) => {
    const converted = reportingCents(receipt, homeCurrency);
    if (converted === null) {
      pendingCount++;
      return null;
    }
    totalCents += converted;
    const month = receipt.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + converted);
    byCar.set(receipt.carId, (byCar.get(receipt.carId) ?? 0) + converted);
    return converted;
  };
  for (const visit of visits) {
    const converted = count(visit);
    if (converted === null) {
      visitPendingCount++;
      continue;
    }
    serviceCents += converted;
    const amounts = allocateConverted(visit, converted);
    for (const [index, item] of visit.items.entries()) {
      if (item.costCents !== null) {
        byCategory.set(item.name, (byCategory.get(item.name) ?? 0) + amounts[index]);
      }
    }
    unallocatedCents += amounts[amounts.length - 1];
  }
  for (const entry of fuelEntries) fuelCents += count(entry) ?? 0;
  for (const expense of expenses) {
    const converted = count(expense);
    if (converted !== null)
      expenseCents.set(expense.category, (expenseCents.get(expense.category) ?? 0) + converted);
  }
  const byType: SpendingType[] = [
    ...(visits.length ? [{ kind: 'service' as const, category: null, amount: serviceCents }] : []),
    ...(fuelEntries.length ? [{ kind: 'fuel' as const, category: null, amount: fuelCents }] : []),
    ...EXPENSE_CATEGORIES.filter((category) => expenseCents.has(category)).map((category) => ({
      kind: 'expense' as const,
      category,
      amount: expenseCents.get(category)!,
    })),
  ];
  return {
    totalCents,
    pendingCount,
    // Converted service visits, the basis of the per-visit average.
    convertedCount: visits.length - visitPendingCount,
    serviceCents,
    byType: byType.sort((a, b) => b.amount - a.amount),
    byMonth: [...byMonth].sort(([a], [b]) => a.localeCompare(b)),
    byCar: [...byCar]
      .map(([id, amount]) => ({
        id,
        name: cars.find((car) => car.id === id)?.name ?? null,
        amount,
      }))
      .sort((a, b) => b.amount - a.amount),
    byCategory: [
      ...[...byCategory].map(([name, amount]) => ({ kind: 'category' as const, name, amount })),
      ...(unallocatedCents
        ? [{ kind: 'unallocated' as const, name: null, amount: unallocatedCents }]
        : []),
    ].sort((a, b) => b.amount - a.amount),
  };
}

/**
 * Distance covered by the dated odometer readings (service visits and fill-ups) of each car:
 * its highest reading minus its lowest. Cars without two different readings are left out.
 * Distances in different units cannot be added, so a mix returns 'mixed'.
 */
export function distanceDriven(
  cars: Car[],
  visits: Visit[],
  fuelEntries: FuelEntry[],
): { unit: DistanceUnit; distance: number; carIds: string[] } | 'mixed' | null {
  let unit: DistanceUnit | null = null;
  let distance = 0;
  const carIds: string[] = [];
  for (const car of cars) {
    const readings = [
      ...visits.filter((visit) => visit.carId === car.id).map((visit) => visit.odometer),
      ...fuelEntries.filter((entry) => entry.carId === car.id).map((entry) => entry.odometer),
    ].filter((reading): reading is number => reading !== null);
    if (readings.length < 2) continue;
    const driven = Math.max(...readings) - Math.min(...readings);
    if (driven <= 0) continue;
    if (unit !== null && unit !== car.distanceUnit) return 'mixed';
    unit = car.distanceUnit;
    distance += driven;
    carIds.push(car.id);
  }
  return unit === null ? null : { unit, distance, carIds };
}

const CONVERSION_HEADERS = [
  'Original currency',
  'Reporting currency',
  'Converted total',
  'Conversion source',
  'Rate date',
];

// Home-currency columns shared by every export. Conversion details are only reported while
// they still match the receipt; they are blank while a conversion is pending.
function conversionColumns(receipt: Receipt, homeCurrency: Currency): (string | number)[] {
  const currency = currencyOrDefault(receipt.currency);
  const converted = reportingCents(receipt, homeCurrency);
  const conversion = converted === null ? undefined : receipt.conversions?.[homeCurrency];
  return [
    currency,
    homeCurrency,
    converted === null ? '' : centsToInput(converted),
    currency === homeCurrency ? 'same-currency' : (conversion?.source ?? ''),
    conversion?.rateDate ?? '',
  ];
}

function escapeCsv(value: string | number): string {
  // Prefix user text that spreadsheets would otherwise evaluate as a formula.
  const text =
    typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function visitsToCsv(visits: Visit[], cars: Car[], homeCurrency: Currency = 'USD'): string {
  const headers = [
    'Date',
    'Car',
    'Odometer',
    'Distance unit',
    'Provider',
    'Items',
    'Original total',
    'Original item costs',
    'Notes',
    'Photo count',
    ...CONVERSION_HEADERS,
  ];
  const rows = visits.map((visit) => {
    const car = cars.find((entry) => entry.id === visit.carId);
    return [
      visit.date,
      car?.name ?? 'Unknown car',
      visit.odometer ?? '',
      distanceAbbreviation(car?.distanceUnit),
      visit.provider,
      visit.items.map((item) => item.name).join('; '),
      centsToInput(visit.totalCostCents),
      visit.items
        .map((item) =>
          item.costCents === null ? '' : `${item.name}: ${centsToInput(item.costCents)}`,
        )
        .filter(Boolean)
        .join('; '),
      visit.notes,
      visit.photos.length,
      ...conversionColumns(visit, homeCurrency),
    ];
  });
  return toCsv(headers, rows);
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  return (
    '\uFEFF' + [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n') + '\r\n'
  );
}

export function fuelToCsv(
  entries: FuelEntry[],
  cars: Car[],
  homeCurrency: Currency = 'USD',
  economy: (entry: FuelEntry) => number | null = () => null,
): string {
  const headers = [
    'Date',
    'Car',
    'Odometer',
    'Distance unit',
    'Volume',
    'Volume unit',
    'Gas type',
    'Price per unit',
    'Original total',
    'Full tank',
    'Missed previous',
    'Economy',
    'Economy unit',
    'Station',
    'Notes',
    'Photo count',
    ...CONVERSION_HEADERS,
  ];
  const rows = entries.map((entry) => {
    const car = cars.find((item) => item.id === entry.carId);
    const value = economy(entry);
    return [
      entry.date,
      car?.name ?? 'Unknown car',
      entry.odometer,
      distanceAbbreviation(car?.distanceUnit),
      formatMilli(entry.volumeMilli),
      entry.volumeUnit === 'gallons' ? 'gal' : 'L',
      entry.fuelType,
      formatMilli(entry.unitPriceMilli),
      centsToInput(entry.totalCostCents),
      entry.isFullTank ? 'yes' : 'no',
      entry.missedPrevious ? 'yes' : 'no',
      value === null ? '' : value.toFixed(2),
      value === null ? '' : car?.distanceUnit === 'kilometers' ? 'L/100 km' : 'mpg',
      entry.station,
      entry.notes,
      entry.photos.length,
      ...conversionColumns(entry, homeCurrency),
    ];
  });
  return toCsv(headers, rows);
}

export function expensesToCsv(
  expenses: Expense[],
  cars: Car[],
  homeCurrency: Currency = 'USD',
): string {
  const headers = [
    'Date',
    'Car',
    'Category',
    'Description',
    'Original total',
    'Renews on',
    'Notes',
    ...CONVERSION_HEADERS,
  ];
  const rows = expenses.map((expense) => [
    expense.date,
    cars.find((item) => item.id === expense.carId)?.name ?? 'Unknown car',
    expense.category,
    expense.description,
    centsToInput(expense.totalCostCents),
    expense.renewsOn ?? '',
    expense.notes,
    ...conversionColumns(expense, homeCurrency),
  ]);
  return toCsv(headers, rows);
}

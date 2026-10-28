import { distanceAbbreviation, type Car, type Visit } from '../garage/model';
import {
  allocateConverted,
  currencyOrDefault,
  reportingCents,
  type Currency,
} from '../currency/currency';

export function reportTotals(visits: Visit[], cars: Car[], homeCurrency: Currency = 'USD') {
  const byMonth = new Map<string, number>();
  const byCar = new Map<string, number>();
  const byCategory = new Map<string, number>();
  let unallocatedCents = 0;
  let totalCents = 0;
  let pendingCount = 0;
  for (const visit of visits) {
    const converted = reportingCents(visit, homeCurrency);
    if (converted === null) {
      pendingCount++;
      continue;
    }
    totalCents += converted;
    byMonth.set(visit.date.slice(0, 7), (byMonth.get(visit.date.slice(0, 7)) ?? 0) + converted);
    byCar.set(visit.carId, (byCar.get(visit.carId) ?? 0) + converted);
    const amounts = allocateConverted(visit, converted);
    for (const [index, item] of visit.items.entries()) {
      if (item.costCents !== null) {
        byCategory.set(item.name, (byCategory.get(item.name) ?? 0) + amounts[index]);
      }
    }
    unallocatedCents += amounts[amounts.length - 1];
  }
  return {
    totalCents,
    pendingCount,
    convertedCount: visits.length - pendingCount,
    byMonth: [...byMonth].sort(([a], [b]) => a.localeCompare(b)),
    byCar: [...byCar].map(([id, amount]) => ({
      id,
      name: cars.find((car) => car.id === id)?.name ?? null,
      amount,
    })),
    byCategory: [
      ...[...byCategory].map(([name, amount]) => ({ kind: 'category' as const, name, amount })),
      ...(unallocatedCents
        ? [{ kind: 'unallocated' as const, name: null, amount: unallocatedCents }]
        : []),
    ].sort((a, b) => b.amount - a.amount),
  };
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
    'Original currency',
    'Reporting currency',
    'Converted total',
    'Conversion source',
    'Rate date',
  ];
  const rows = visits.map((visit) => [
    visit.date,
    cars.find((car) => car.id === visit.carId)?.name ?? 'Unknown car',
    visit.odometer ?? '',
    distanceAbbreviation(cars.find((car) => car.id === visit.carId)?.distanceUnit),
    visit.provider,
    visit.items.map((item) => item.name).join('; '),
    (visit.totalCostCents / 100).toFixed(2),
    visit.items
      .map((item) =>
        item.costCents === null ? '' : `${item.name}: ${(item.costCents / 100).toFixed(2)}`,
      )
      .filter(Boolean)
      .join('; '),
    visit.notes,
    visit.photos.length,
    currencyOrDefault(visit.currency),
    homeCurrency,
    reportingCents(visit, homeCurrency) === null
      ? ''
      : (reportingCents(visit, homeCurrency)! / 100).toFixed(2),
    currencyOrDefault(visit.currency) === homeCurrency
      ? 'same-currency'
      : reportingCents(visit, homeCurrency) === null
        ? ''
        : (visit.conversions?.[homeCurrency]?.source ?? ''),
    reportingCents(visit, homeCurrency) === null
      ? ''
      : (visit.conversions?.[homeCurrency]?.rateDate ?? ''),
  ]);
  return (
    '\uFEFF' + [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n') + '\r\n'
  );
}

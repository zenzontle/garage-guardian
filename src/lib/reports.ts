import { distanceAbbreviation, type Car, type Visit } from "./model";

export function reportTotals(visits: Visit[], cars: Car[]) {
  const byMonth = new Map<string, number>();
  const byCar = new Map<string, number>();
  const byCategory = new Map<string, number>();
  let unallocatedCents = 0;
  for (const visit of visits) {
    byMonth.set(visit.date.slice(0, 7), (byMonth.get(visit.date.slice(0, 7)) ?? 0) + visit.totalCostCents);
    byCar.set(visit.carId, (byCar.get(visit.carId) ?? 0) + visit.totalCostCents);
    let allocated = 0;
    for (const item of visit.items) {
      if (item.costCents !== null) {
        allocated += item.costCents;
        byCategory.set(item.name, (byCategory.get(item.name) ?? 0) + item.costCents);
      }
    }
    const unallocated = Math.max(0, visit.totalCostCents - allocated);
    unallocatedCents += unallocated;
  }
  return {
    totalCents: visits.reduce((sum, visit) => sum + visit.totalCostCents, 0),
    byMonth: [...byMonth].sort(([a], [b]) => a.localeCompare(b)),
    byCar: [...byCar].map(([id, amount]) => ({ id, name: cars.find((car) => car.id === id)?.name ?? null, amount })),
    byCategory: [
      ...[...byCategory].map(([name, amount]) => ({ kind: 'category' as const, name, amount })),
      ...(unallocatedCents ? [{ kind: 'unallocated' as const, name: null, amount: unallocatedCents }] : []),
    ].sort((a, b) => b.amount - a.amount),
  };
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function visitsToCsv(visits: Visit[], cars: Car[]): string {
  const headers = ["Date", "Car", "Odometer", "Distance unit", "Provider", "Items", "Total cost (USD)", "Item costs (USD)", "Notes", "Photo count"];
  const rows = visits.map((visit) => [
    visit.date,
    cars.find((car) => car.id === visit.carId)?.name ?? "Unknown car",
    visit.odometer,
    distanceAbbreviation(cars.find((car) => car.id === visit.carId)?.distanceUnit),
    visit.provider,
    visit.items.map((item) => item.name).join("; "),
    (visit.totalCostCents / 100).toFixed(2),
    visit.items.map((item) => item.costCents === null ? "" : `${item.name}: ${(item.costCents / 100).toFixed(2)}`).filter(Boolean).join("; "),
    visit.notes,
    visit.photos.length,
  ]);
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n") + "\r\n";
}

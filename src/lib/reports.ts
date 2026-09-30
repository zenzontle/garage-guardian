import type { Car, Visit } from "./model";

export function reportTotals(visits: Visit[], cars: Car[]) {
  const byMonth = new Map<string, number>();
  const byCar = new Map<string, number>();
  const byCategory = new Map<string, number>();
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
    if (unallocated) byCategory.set("Unallocated", (byCategory.get("Unallocated") ?? 0) + unallocated);
  }
  return {
    totalCents: visits.reduce((sum, visit) => sum + visit.totalCostCents, 0),
    byMonth: [...byMonth].sort(([a], [b]) => a.localeCompare(b)),
    byCar: [...byCar].map(([id, amount]) => [cars.find((car) => car.id === id)?.name ?? "Unknown car", amount] as const),
    byCategory: [...byCategory].sort((a, b) => b[1] - a[1]),
  };
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function visitsToCsv(visits: Visit[], cars: Car[]): string {
  const headers = ["Date", "Car", "Odometer (mi)", "Provider", "Items", "Total cost (USD)", "Item costs (USD)", "Notes", "Photo count"];
  const rows = visits.map((visit) => [
    visit.date,
    cars.find((car) => car.id === visit.carId)?.name ?? "Unknown car",
    visit.odometer,
    visit.provider,
    visit.items.map((item) => item.name).join("; "),
    (visit.totalCostCents / 100).toFixed(2),
    visit.items.map((item) => item.costCents === null ? "" : `${item.name}: ${(item.costCents / 100).toFixed(2)}`).filter(Boolean).join("; "),
    visit.notes,
    visit.photos.length,
  ]);
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n") + "\r\n";
}

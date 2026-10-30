import { distanceUnitOrDefault, type Car, type FuelEntry } from '../garage/model';
import { LITERS_PER_GALLON, litersFromVolume } from './fuel';

// Miles cars show miles per US gallon (higher is better); kilometer cars show liters per
// 100 km (lower is better), matching how each market reports economy.
export type EconomyUnit = 'mpg' | 'litersPer100Km';
export type FuelEconomy = {
  unit: EconomyUnit;
  // Economy of the segment each full-tank entry closes, keyed by entry ID.
  byEntry: Map<string, number>;
  // Total distance over total fuel across every valid segment; null without one.
  average: number | null;
};

export const economyUnit = (car: Pick<Car, 'distanceUnit'>): EconomyUnit =>
  distanceUnitOrDefault(car.distanceUnit) === 'kilometers' ? 'litersPer100Km' : 'mpg';

function economyValue(unit: EconomyUnit, distance: number, liters: number): number {
  return unit === 'mpg' ? distance / (liters / LITERS_PER_GALLON) : (liters * 100) / distance;
}

// Each full-tank entry closes a segment that starts at the previous full-tank entry. The
// segment's fuel is everything pumped after that fill, partial fills included. A segment that
// contains a missed fill-up, or no distance, cannot be measured and is skipped.
export function fuelEconomy(car: Car, entries: FuelEntry[]): FuelEconomy {
  const unit = economyUnit(car);
  const byEntry = new Map<string, number>();
  const ordered = entries
    .filter((entry) => entry.carId === car.id)
    .sort(
      (a, b) =>
        a.odometer - b.odometer ||
        a.date.localeCompare(b.date) ||
        a.createdAt.localeCompare(b.createdAt),
    );
  let start: FuelEntry | null = null;
  let liters = 0;
  let missed = false;
  let totalDistance = 0;
  let totalLiters = 0;
  for (const entry of ordered) {
    if (start) {
      liters += litersFromVolume(entry.volumeMilli, entry.volumeUnit);
      missed ||= entry.missedPrevious;
    }
    if (!entry.isFullTank) continue;
    const distance = start ? entry.odometer - start.odometer : 0;
    if (start && !missed && distance > 0 && liters > 0) {
      byEntry.set(entry.id, economyValue(unit, distance, liters));
      totalDistance += distance;
      totalLiters += liters;
    }
    start = entry;
    liters = 0;
    missed = false;
  }
  return {
    unit,
    byEntry,
    average: totalDistance > 0 ? economyValue(unit, totalDistance, totalLiters) : null,
  };
}

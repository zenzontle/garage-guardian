import { AppError } from '../utils/app-error';
import { currencyOrDefault, isCurrency, validCents, validDate } from '../currency/currency';
import type { Car, FuelEntry } from '../garage/model';

// US gallons. Each fill-up chooses its own unit, independent of the car's distance unit.
export const VOLUME_UNITS = ['gallons', 'liters'] as const;
export type VolumeUnit = (typeof VOLUME_UNITS)[number];
export const FUEL_TYPES = ['regular', 'midgrade', 'premium', 'diesel', 'e85', 'other'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const LITERS_PER_GALLON = 3.785411784;
// Matches the database checks: 2,000 gallons or liters, and PostgreSQL's integer range.
export const MAX_VOLUME_MILLI = 2_000_000;
export const MAX_INTEGER = 2147483647;
export const STATION_MAX_LENGTH = 100;
export const FUEL_NOTES_MAX_LENGTH = 2000;
export const FUEL_PHOTO_LIMIT = 3;

export const isVolumeUnit = (value: unknown): value is VolumeUnit =>
  VOLUME_UNITS.some((unit) => unit === value);
export const isFuelType = (value: unknown): value is FuelType =>
  FUEL_TYPES.some((type) => type === value);
const validInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
// Count Unicode characters like PostgreSQL char_length, rather than UTF-16 units.
const characters = (value: string) => Array.from(value).length;

export function normalizeFuelEntry(entry: FuelEntry): FuelEntry {
  return {
    ...entry,
    volumeUnit: isVolumeUnit(entry.volumeUnit) ? entry.volumeUnit : 'gallons',
    fuelType: isFuelType(entry.fuelType) ? entry.fuelType : 'other',
    currency: currencyOrDefault(entry.currency),
    isFullTank: entry.isFullTank ?? true,
    missedPrevious: entry.missedPrevious ?? false,
    station: entry.station ?? '',
    notes: entry.notes ?? '',
    photos: entry.photos ?? [],
  };
}

export function checkedFuelEntry(entry: FuelEntry): FuelEntry {
  const station = (entry.station ?? '').trim();
  const notes = (entry.notes ?? '').trim();
  if (
    !entry.id ||
    !entry.carId ||
    !validDate(entry.date) ||
    !validInteger(entry.odometer, 0, MAX_INTEGER) ||
    !validInteger(entry.volumeMilli, 1, MAX_VOLUME_MILLI) ||
    !isVolumeUnit(entry.volumeUnit) ||
    !isFuelType(entry.fuelType) ||
    !validInteger(entry.unitPriceMilli, 0, MAX_INTEGER) ||
    !validCents(entry.totalCostCents) ||
    !isCurrency(entry.currency) ||
    typeof entry.isFullTank !== 'boolean' ||
    typeof entry.missedPrevious !== 'boolean' ||
    characters(station) > STATION_MAX_LENGTH ||
    characters(notes) > FUEL_NOTES_MAX_LENGTH ||
    !Array.isArray(entry.photos) ||
    entry.photos.length > FUEL_PHOTO_LIMIT
  )
    throw new AppError('fuelFields');
  return { ...entry, station, notes };
}

// Parse a decimal with up to three places into integer thousandths. Empty input is missing.
export function parseMilli(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{0,3})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(milli) && milli <= MAX_INTEGER ? milli : null;
}

export const formatMilli = (milli: number) => (milli / 1000).toFixed(3).replace(/\.?0+$/, '');

// volume × price: thousandths × thousandths of currency = millionths of currency → cents.
export const computeTotalCents = (volumeMilli: number, unitPriceMilli: number) =>
  Math.round((volumeMilli * unitPriceMilli) / 10000);

export function computeUnitPriceMilli(totalCostCents: number, volumeMilli: number): number | null {
  if (volumeMilli <= 0) return null;
  const price = Math.round((totalCostCents * 10000) / volumeMilli);
  return price <= MAX_INTEGER ? price : null;
}

export function computeVolumeMilli(totalCostCents: number, unitPriceMilli: number): number | null {
  if (unitPriceMilli <= 0) return null;
  const volume = Math.round((totalCostCents * 10000) / unitPriceMilli);
  return volume > 0 && volume <= MAX_VOLUME_MILLI ? volume : null;
}

export const litersFromVolume = (volumeMilli: number, unit: VolumeUnit) =>
  (volumeMilli / 1000) * (unit === 'gallons' ? LITERS_PER_GALLON : 1);

export const defaultVolumeUnit = (car?: Pick<Car, 'distanceUnit'>): VolumeUnit =>
  car?.distanceUnit === 'kilometers' ? 'liters' : 'gallons';

const newestFirst = (a: FuelEntry, b: FuelEntry) =>
  b.date.localeCompare(a.date) || b.odometer - a.odometer || b.createdAt.localeCompare(a.createdAt);

export function sortFuelEntries(entries: FuelEntry[]): FuelEntry[] {
  return [...entries].sort(newestFirst);
}

export function lastFuelEntry(carId: string, entries: FuelEntry[]): FuelEntry | null {
  return sortFuelEntries(entries.filter((entry) => entry.carId === carId))[0] ?? null;
}

export function carStations(carId: string, entries: FuelEntry[]): string[] {
  const seen = new Set<string>();
  return sortFuelEntries(entries.filter((entry) => entry.carId === carId && entry.station))
    .map((entry) => entry.station)
    .filter((station) => {
      const key = station.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Readings never decrease over time: an entry must be at or above every earlier-dated reading
// and at or below every later-dated reading for the same car. Same-day entries may be in any order.
export function fuelOdometerInOrder(entry: FuelEntry, entries: FuelEntry[]): boolean {
  return entries.every(
    (other) =>
      other.id === entry.id ||
      other.carId !== entry.carId ||
      (other.date < entry.date && other.odometer <= entry.odometer) ||
      (other.date > entry.date && other.odometer >= entry.odometer) ||
      other.date === entry.date,
  );
}

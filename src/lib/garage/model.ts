import { AppError } from '../utils/app-error';
import {
  normalizeVisit,
  currencyOrDefault,
  type Currency,
  type Conversions,
} from '../currency/currency';

export type { Currency } from '../currency/currency';

export type DistanceUnit = 'miles' | 'kilometers';

// All distance values, including legacy *Miles fields, use the owning car's unit.
export type Car = {
  id: string;
  name: string;
  year: number;
  make: string;
  model: string;
  vin: string;
  plate: string;
  distanceUnit: DistanceUnit;
  odometer: number;
  reminderDays: number;
  reminderMiles: number;
  createdAt: string;
};

export type ScheduleItem = {
  id: string;
  carId: string;
  name: string;
  intervalMiles: number | null;
  intervalMonths: number | null;
  firstDueMiles: number | null;
  firstDueDate: string | null;
  sourceNote: string;
  isActive: boolean;
  createdAt: string;
};

export type VisitItem = {
  id: string;
  name: string;
  scheduleItemId: string | null;
  costCents: number | null;
};

export type Photo = {
  id: string;
  name: string;
  path: string;
  contentType: string;
};

export type Visit = {
  id: string;
  carId: string;
  date: string;
  odometer: number | null;
  totalCostCents: number;
  currency?: Currency;
  conversions?: Conversions;
  provider: string;
  notes: string;
  items: VisitItem[];
  photos: Photo[];
  createdAt: string;
};

export type Snapshot = {
  pendingSyncCount?: number;
  syncConflictCount?: number;
  homeCurrency?: Currency;
  cars: Car[];
  schedules: ScheduleItem[];
  visits: Visit[];
};

export const EMPTY_SNAPSHOT: Snapshot = { cars: [], schedules: [], visits: [] };

const STARTER_DEFAULTS = [
  { name: 'Oil change', months: 12, miles: 7500, kilometers: 12000 },
  { name: 'Tire rotation', months: 6, miles: 6000, kilometers: 10000 },
  { name: 'Tire replacement', months: 60, miles: 50000, kilometers: 80000 },
  { name: 'Engine air filter', months: 18, miles: 20000, kilometers: 30000 },
  { name: 'Cabin air filter', months: 12, miles: 15000, kilometers: 25000 },
];

export const STARTER_TASKS = STARTER_DEFAULTS.map((task) => task.name);

export const newId = () => crypto.randomUUID();

export function makeStarterSchedules(
  carId: string,
  names: readonly string[] = STARTER_TASKS,
  distanceUnit: DistanceUnit = 'miles',
): ScheduleItem[] {
  return names.map((name, index) => ({
    id: newId(),
    carId,
    name,
    intervalMiles: STARTER_DEFAULTS[index]?.[distanceUnit] ?? null,
    intervalMonths: STARTER_DEFAULTS[index]?.months ?? null,
    firstDueMiles: null,
    firstDueDate: null,
    sourceNote: '',
    isActive: true,
    createdAt: new Date().toISOString(),
  }));
}

export function money(cents: number, currency: Currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(cents / 100);
}

export function distanceUnitOrDefault(unit?: DistanceUnit | null): DistanceUnit {
  return unit ?? 'miles';
}

export function distanceAbbreviation(unit?: DistanceUnit): string {
  return distanceUnitOrDefault(unit) === 'kilometers' ? 'km' : 'mi';
}

export function defaultReminderDistance(unit?: DistanceUnit): number {
  return distanceUnitOrDefault(unit) === 'kilometers' ? 1000 : 500;
}

export function formatDistance(distance: number, unit?: DistanceUnit): string {
  return `${new Intl.NumberFormat('en-US').format(distance)} ${distanceAbbreviation(unit)}`;
}

export function distanceInMiles(distance: number, unit?: DistanceUnit): number {
  return distanceUnitOrDefault(unit) === 'kilometers' ? distance / 1.609344 : distance;
}

export function normalizeCar(car: Car): Car {
  const distanceUnit = distanceUnitOrDefault(car.distanceUnit);
  return {
    ...car,
    plate: car.plate ?? '',
    distanceUnit,
    reminderMiles: car.reminderMiles ?? defaultReminderDistance(distanceUnit),
  };
}

export const PLATE_MAX_LENGTH = 20;

export function normalizePlate(plate?: string | null): string {
  const value = (plate ?? '').trim();
  // Count Unicode characters like PostgreSQL char_length, rather than UTF-16 units.
  if (Array.from(value).length > PLATE_MAX_LENGTH) {
    throw new AppError('plateLength', { count: PLATE_MAX_LENGTH });
  }
  return value;
}

export function normalizeSnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    homeCurrency: currencyOrDefault(snapshot.homeCurrency),
    cars: snapshot.cars.map(normalizeCar),
    visits: snapshot.visits.map(normalizeVisit),
  };
}

export function displayDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}

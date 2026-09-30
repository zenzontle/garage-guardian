export type Car = {
  id: string;
  name: string;
  year: number;
  make: string;
  model: string;
  vin: string;
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
  odometer: number;
  totalCostCents: number;
  provider: string;
  notes: string;
  items: VisitItem[];
  photos: Photo[];
  createdAt: string;
};

export type Snapshot = {
  cars: Car[];
  schedules: ScheduleItem[];
  visits: Visit[];
};

export const EMPTY_SNAPSHOT: Snapshot = { cars: [], schedules: [], visits: [] };

export const STARTER_TASKS = [
  "Oil change",
  "Tire rotation",
  "Tire replacement",
  "Engine air filter",
  "Cabin air filter",
  "Scheduled service",
];

export const newId = () => crypto.randomUUID();

export function makeStarterSchedules(carId: string): ScheduleItem[] {
  return STARTER_TASKS.map((name) => ({
    id: newId(), carId, name, intervalMiles: null, intervalMonths: null,
    firstDueMiles: null, firstDueDate: null, sourceNote: "", isActive: true,
    createdAt: new Date().toISOString(),
  }));
}

export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function formatMiles(miles: number): string {
  return `${new Intl.NumberFormat("en-US").format(miles)} mi`;
}

export function displayDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(year, month - 1, day));
}

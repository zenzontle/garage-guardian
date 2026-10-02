import { defaultReminderDistance, formatDistance, type Car, type ScheduleItem, type Visit } from "./model";

export type DueStatus = "setup" | "upcoming" | "due" | "later" | "completed";
export type DueItem = {
  schedule: ScheduleItem;
  car: Car;
  status: DueStatus;
  dueDate: string | null;
  dueMiles: number | null;
  daysRemaining: number | null;
  milesRemaining: number | null;
  lastDone: Visit | null;
};

export function addMonths(iso: string, count: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  const finalDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, finalDay));
  return target.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function latestOdometer(car: Car, visits: Visit[]): number {
  return visits.filter((visit) => visit.carId === car.id)
    .reduce((highest, visit) => Math.max(highest, visit.odometer), car.odometer);
}

export function getDueItem(schedule: ScheduleItem, car: Car, visits: Visit[], today: string): DueItem {
  const completed = visits
    .filter((visit) => visit.carId === car.id && visit.items.some((item) => item.scheduleItemId === schedule.id))
    .sort((a, b) => b.date.localeCompare(a.date) || b.odometer - a.odometer);
  const lastDone = completed[0] ?? null;
  const isRecurring = schedule.intervalMiles !== null || schedule.intervalMonths !== null;

  if (lastDone && !isRecurring) {
    return { schedule, car, status: "completed", dueDate: null, dueMiles: null,
      daysRemaining: null, milesRemaining: null, lastDone };
  }

  const dueDate = lastDone
    ? schedule.intervalMonths !== null ? addMonths(lastDone.date, schedule.intervalMonths) : null
    : schedule.firstDueDate;
  const dueMiles = lastDone
    ? schedule.intervalMiles !== null ? lastDone.odometer + schedule.intervalMiles : null
    : schedule.firstDueMiles;
  const daysRemaining = dueDate ? daysBetween(today, dueDate) : null;
  const milesRemaining = dueMiles !== null ? dueMiles - latestOdometer(car, visits) : null;
  let status: DueStatus = "later";
  if (dueDate === null && dueMiles === null) status = "setup";
  else if ((daysRemaining !== null && daysRemaining <= 0) || (milesRemaining !== null && milesRemaining <= 0)) status = "due";
  else if ((daysRemaining !== null && daysRemaining <= (car.reminderDays ?? 30)) || (milesRemaining !== null && milesRemaining <= (car.reminderMiles ?? defaultReminderDistance(car.distanceUnit)))) status = "upcoming";
  return { schedule, car, status, dueDate, dueMiles, daysRemaining, milesRemaining, lastDone };
}

export function getAllDue(cars: Car[], schedules: ScheduleItem[], visits: Visit[], today: string): DueItem[] {
  const carMap = new Map(cars.map((car) => [car.id, car]));
  const rank: Record<DueStatus, number> = { due: 0, upcoming: 1, later: 2, setup: 3, completed: 4 };
  return schedules.filter((item) => item.isActive).flatMap((item) => {
    const car = carMap.get(item.carId);
    return car ? [getDueItem(item, car, visits, today)] : [];
  }).sort((a, b) => rank[a.status] - rank[b.status] || a.schedule.name.localeCompare(b.schedule.name));
}

export function dueDescription(item: DueItem): string {
  if (item.status === "setup") return "Add a due date or odometer reading";
  if (item.status === "completed") return "One-time task completed";
  const pieces: string[] = [];
  if (item.dueDate) pieces.push(`by ${item.dueDate}`);
  if (item.dueMiles !== null) pieces.push(`at ${formatDistance(item.dueMiles, item.car.distanceUnit)}`);
  return pieces.join(" or ");
}

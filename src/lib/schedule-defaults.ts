import type { SupabaseClient } from '@supabase/supabase-js';
import { addMonths, latestOdometer } from './due';
import type { Car, ScheduleItem, Snapshot, Visit } from './model';

export function initializeSchedule(
  item: ScheduleItem,
  car: Car,
  visits: Visit[],
  today: string,
): ScheduleItem {
  if (
    !item.isActive ||
    item.firstDueDate !== null ||
    item.firstDueMiles !== null ||
    (item.intervalMiles === null && item.intervalMonths === null)
  )
    return item;
  const reading = latestOdometer(car, visits);
  return {
    ...item,
    firstDueMiles:
      item.intervalMiles === null
        ? null
        : Math.max(1, Math.ceil(reading / item.intervalMiles)) * item.intervalMiles,
    firstDueDate: item.intervalMonths === null ? null : addMonths(today, item.intervalMonths),
  };
}

export function initializeSnapshotSchedules(snapshot: Snapshot, today: string): Snapshot {
  const cars = new Map(snapshot.cars.map((car) => [car.id, car]));
  const schedules = snapshot.schedules.map((item) => {
    const car = cars.get(item.carId);
    return car ? initializeSchedule(item, car, snapshot.visits, today) : item;
  });
  return schedules.some((item, index) => item !== snapshot.schedules[index])
    ? { ...snapshot, schedules }
    : snapshot;
}

export async function initializeCloudSchedules(
  db: SupabaseClient,
  userId: string,
  snapshot: Snapshot,
  today: string,
): Promise<Snapshot> {
  const initialized = initializeSnapshotSchedules(snapshot, today);
  if (initialized === snapshot) return snapshot;
  const schedules: ScheduleItem[] = [];
  for (const [index, item] of initialized.schedules.entries()) {
    if (item === snapshot.schedules[index]) {
      schedules.push(item);
      continue;
    }
    // The transaction locks the baseline inputs and returns the current row even if a guard fails.
    const { data, error } = await db.rpc('initialize_schedule_defaults', {
      p_user_id: userId,
      p_schedule_id: item.id,
      p_car_id: item.carId,
      p_interval_miles: item.intervalMiles,
      p_interval_months: item.intervalMonths,
      p_today: today,
    } satisfies InitializeScheduleDefaultsArgs);
    if (error) throw error;
    const row = data?.[0];
    if (row)
      schedules.push({
        id: row.id,
        carId: row.car_id,
        name: row.name,
        intervalMiles: row.interval_miles,
        intervalMonths: row.interval_months,
        firstDueMiles: row.first_due_miles,
        firstDueDate: row.first_due_date,
        sourceNote: row.source_note,
        isActive: row.is_active,
        createdAt: row.created_at,
      });
  }
  return { ...snapshot, schedules };
}

export type InitializeScheduleDefaultsArgs = {
  p_user_id: string;
  p_schedule_id: string;
  p_car_id: string;
  p_interval_miles: number | null;
  p_interval_months: number | null;
  p_today: string;
};

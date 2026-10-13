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
  for (const [index, item] of initialized.schedules.entries()) {
    if (item === snapshot.schedules[index]) continue;
    // Only fill still-empty due points; never overwrite another tab's interval or due-point edit.
    let query = db
      .from('schedule_items')
      .update({ first_due_miles: item.firstDueMiles, first_due_date: item.firstDueDate })
      .eq('user_id', userId)
      .eq('id', item.id)
      .is('first_due_miles', null)
      .is('first_due_date', null);
    query =
      item.intervalMiles === null
        ? query.is('interval_miles', null)
        : query.eq('interval_miles', item.intervalMiles);
    query =
      item.intervalMonths === null
        ? query.is('interval_months', null)
        : query.eq('interval_months', item.intervalMonths);
    const { data, error } = await query.select('first_due_miles, first_due_date');
    if (error) throw error;
    if (!data?.length) initialized.schedules[index] = snapshot.schedules[index];
  }
  return initialized;
}

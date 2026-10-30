import type { SupabaseClient } from '@supabase/supabase-js';
import { getAllDue } from '@/lib/maintenance/due';
import { normalizeCar, type ScheduleItem, type Visit, type Snapshot } from '@/lib/garage/model';
import { fuelFromRow } from '@/lib/fuel/fuel-rows';
import { initializeCloudSchedules } from '@/lib/maintenance/schedule-defaults';

// Page every owner-scoped table: a user's history may exceed PostgREST's row limit.
async function rows(db: SupabaseClient, table: string, userId: string, activeOnly = false) {
  const collected = [];
  for (let offset = 0; ; offset += 500) {
    let query = db
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .order('id')
      .range(offset, offset + 499);
    if (activeOnly) query = query.eq('is_archived', false);
    const { data, error } = await query;
    if (error) throw new Error('maintenance_load');
    collected.push(...(data ?? []));
    if (!data || data.length < 500) return collected;
  }
}

export async function loadReminderItems(db: SupabaseClient, userId: string, today: string) {
  const [cars, schedules, visits, fuelEntries] = await Promise.all([
    rows(db, 'cars', userId, true),
    rows(db, 'schedule_items', userId),
    rows(db, 'visits', userId),
    rows(db, 'fuel_entries', userId),
  ]);
  const snapshot: Snapshot = {
    cars: cars.map((row) =>
      normalizeCar({
        id: row.id,
        name: row.name,
        year: row.year,
        make: row.make,
        model: row.model,
        vin: row.vin,
        plate: row.plate,
        isArchived: row.is_archived,
        distanceUnit: row.distance_unit,
        odometer: row.odometer,
        reminderDays: row.reminder_days,
        reminderMiles: row.reminder_miles,
        createdAt: row.created_at,
      }),
    ),
    schedules: schedules.map((row): ScheduleItem => ({
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
    })),
    visits: visits.map((row): Visit => ({
      id: row.id,
      carId: row.car_id,
      date: row.service_date,
      odometer: row.odometer,
      totalCostCents: row.total_cost_cents,
      provider: row.provider,
      notes: row.notes,
      items: row.items ?? [],
      photos: [],
      createdAt: row.created_at,
    })),
    fuelEntries: fuelEntries.map(fuelFromRow),
  };
  const initialized = await initializeCloudSchedules(db, userId, snapshot, today);
  return getAllDue(
    initialized.cars,
    initialized.schedules,
    initialized.visits,
    today,
    initialized.fuelEntries,
  ).filter((item) => item.status === 'due' || item.status === 'upcoming');
}

// Recheck after preparing the digest, as a vehicle may have been archived or deleted meanwhile.
export async function eligibleReminderItems(
  db: SupabaseClient,
  userId: string,
  items: Awaited<ReturnType<typeof loadReminderItems>>,
) {
  const cars = await rows(db, 'cars', userId, true);
  const active = new Set(cars.map((car) => car.id));
  return items.filter((item) => active.has(item.car.id));
}

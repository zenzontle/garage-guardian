import { addMonths } from '@/lib/maintenance/due';
import type { InitializeScheduleDefaultsArgs } from '@/lib/maintenance/schedule-defaults';

type Row = Record<string, unknown>;

// In-memory RPC contract for repository/worker tests; SQL behavior is tested separately.
export function scheduleDefaultsRpc(
  tables: Record<string, Row[]>,
  args: InitializeScheduleDefaultsArgs,
) {
  const item = tables.schedule_items?.find(
    (row) => row.id === args.p_schedule_id && row.user_id === args.p_user_id,
  );
  if (!item) return [];
  const car = tables.cars?.find(
    (row) => row.id === args.p_car_id && row.user_id === args.p_user_id,
  );
  if (
    car &&
    item.car_id === car.id &&
    item.is_active &&
    item.first_due_miles === null &&
    item.first_due_date === null &&
    item.interval_miles === args.p_interval_miles &&
    item.interval_months === args.p_interval_months &&
    (item.interval_miles !== null || item.interval_months !== null)
  ) {
    const reading = [...(tables.visits ?? []), ...(tables.fuel_entries ?? [])]
      .filter((row) => row.car_id === car.id && row.user_id === args.p_user_id)
      .reduce((value, row) => Math.max(value, Number(row.odometer ?? value)), Number(car.odometer));
    item.first_due_miles =
      args.p_interval_miles === null
        ? null
        : Math.max(1, Math.ceil(reading / args.p_interval_miles)) * args.p_interval_miles;
    item.first_due_date =
      args.p_interval_months === null ? null : addMonths(args.p_today, args.p_interval_months);
  }
  return [structuredClone(item)];
}

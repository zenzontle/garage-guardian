import type { FuelEntry } from '../garage/model';
import { normalizeFuelEntry } from './fuel';

// Shared by the browser repository and the reminder worker, so both read the same columns.
export const fuelToRow = (entry: FuelEntry, userId: string) => ({
  id: entry.id,
  user_id: userId,
  car_id: entry.carId,
  fuel_date: entry.date,
  odometer: entry.odometer,
  volume_milli: entry.volumeMilli,
  volume_unit: entry.volumeUnit,
  fuel_type: entry.fuelType,
  unit_price_milli: entry.unitPriceMilli,
  total_cost_cents: entry.totalCostCents,
  currency: entry.currency,
  is_full_tank: entry.isFullTank,
  missed_previous: entry.missedPrevious,
  station: entry.station,
  notes: entry.notes,
  photos: entry.photos,
  created_at: entry.createdAt,
});

export type FuelRow = ReturnType<typeof fuelToRow>;

export const fuelFromRow = (row: FuelRow): FuelEntry =>
  normalizeFuelEntry({
    id: row.id,
    carId: row.car_id,
    date: row.fuel_date,
    odometer: row.odometer,
    volumeMilli: row.volume_milli,
    volumeUnit: row.volume_unit,
    fuelType: row.fuel_type,
    unitPriceMilli: row.unit_price_milli,
    totalCostCents: row.total_cost_cents,
    currency: row.currency,
    isFullTank: row.is_full_tank,
    missedPrevious: row.missed_previous,
    station: row.station,
    notes: row.notes,
    photos: row.photos ?? [],
    createdAt: row.created_at,
  });

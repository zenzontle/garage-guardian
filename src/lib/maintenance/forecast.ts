import {
  distanceUnitOrDefault,
  type Car,
  type DistanceUnit,
  type FuelEntry,
  type Visit,
} from '../garage/model';

/** Only readings from this many days back (up to today) feed the driving rate. */
export const RATE_WINDOW_DAYS = 365;
/** Distinct reading days needed across the usable pairs. */
export const MIN_RATE_READINGS = 3;
/** Days the usable pairs must cover together. */
export const MIN_RATE_SPAN_DAYS = 30;
/** Forecasts further out than this are too uncertain to show. */
export const MAX_FORECAST_DAYS = 3 * 365;
/** A pair faster than this is a typo or a replaced odometer, not driving. */
const MAX_DAILY_DISTANCE: Record<DistanceUnit, number> = { miles: 1_000, kilometers: 1_600 };

export type OdometerReading = { date: string; odometer: number };
export type DrivingForecast = {
  /** Average distance per day in the car's own unit. */
  dailyDistance: number;
  /** The latest reading the projection starts from. */
  anchor: OdometerReading;
};

const DAY = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY);
const addDays = (iso: string, days: number) =>
  new Date(toTime(iso) + days * DAY).toISOString().slice(0, 10);

/**
 * Dated odometer readings for one car: service visits with a reading and fill-ups, oldest
 * first. The vehicle's own odometer is not one of them: it has no date (the car's creation
 * time says nothing about when it was last edited), so it only serves as the current reading
 * in forecastDistanceDate. Readings dated after today are ignored.
 */
export function odometerReadings(
  car: Car,
  visits: Visit[],
  fuelEntries: FuelEntry[],
  today: string,
): OdometerReading[] {
  const dated: OdometerReading[] = [
    ...visits.flatMap((visit) =>
      visit.carId === car.id && visit.odometer !== null
        ? [{ date: visit.date, odometer: visit.odometer }]
        : [],
    ),
    ...fuelEntries
      .filter((entry) => entry.carId === car.id)
      .map((entry) => ({ date: entry.date, odometer: entry.odometer })),
  ].filter((reading) => reading.date <= today);
  return dated.sort((a, b) => a.date.localeCompare(b.date) || a.odometer - b.odometer);
}

/**
 * Estimates how far a car is driven per day from its recent readings, or null when the
 * readings are too few or too close together to trust. Same-day readings count once (the
 * highest), and pairs that go backward, stand still, or jump implausibly far are skipped, so
 * a replaced odometer or a typo does not skew the rate.
 */
export function drivingForecast(
  car: Car,
  visits: Visit[],
  fuelEntries: FuelEntry[],
  today: string,
): DrivingForecast | null {
  const windowStart = addDays(today, -RATE_WINDOW_DAYS);
  const days: OdometerReading[] = [];
  for (const reading of odometerReadings(car, visits, fuelEntries, today)) {
    if (reading.date < windowStart) continue;
    const last = days.at(-1);
    if (last?.date === reading.date) last.odometer = Math.max(last.odometer, reading.odometer);
    else days.push({ ...reading });
  }
  const limit = MAX_DAILY_DISTANCE[distanceUnitOrDefault(car.distanceUnit)];
  const usedDays = new Set<string>();
  let distance = 0;
  let span = 0;
  for (let index = 1; index < days.length; index++) {
    const from = days[index - 1];
    const to = days[index];
    const gap = daysBetween(from.date, to.date);
    const driven = to.odometer - from.odometer;
    if (driven <= 0 || driven / gap > limit) continue;
    distance += driven;
    span += gap;
    usedDays.add(from.date).add(to.date);
  }
  if (usedDays.size < MIN_RATE_READINGS || span < MIN_RATE_SPAN_DAYS) return null;
  // Project from the highest reading, as due calculations do; its latest day if repeated.
  const anchor = days.reduce((best, reading) =>
    reading.odometer >= best.odometer ? reading : best,
  );
  return { dailyDistance: distance / span, anchor };
}

/**
 * The approximate day a car reaches `dueDistance`, never before today, or null when the
 * distance has already been reached or the estimate lies beyond MAX_FORECAST_DAYS.
 * `currentOdometer` is the car's latest known reading; when it is higher than every dated
 * reading (an edited vehicle odometer), the projection starts from it today.
 */
export function forecastDistanceDate(
  forecast: DrivingForecast,
  dueDistance: number,
  currentOdometer: number,
  today: string,
): string | null {
  if (dueDistance <= currentOdometer) return null;
  const anchor =
    currentOdometer > forecast.anchor.odometer
      ? { date: today, odometer: currentOdometer }
      : forecast.anchor;
  const reached = addDays(
    anchor.date,
    Math.ceil((dueDistance - anchor.odometer) / forecast.dailyDistance),
  );
  const date = reached < today ? today : reached;
  return daysBetween(today, date) > MAX_FORECAST_DAYS ? null : date;
}

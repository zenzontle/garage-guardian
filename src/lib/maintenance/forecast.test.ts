import { describe, expect, it } from 'vitest';
import type { Car, FuelEntry, ScheduleItem, Visit } from '../garage/model';
import { approximateDueDate, getAllDue, getDueItem } from './due';
import {
  MAX_FORECAST_DAYS,
  drivingForecast,
  forecastDistanceDate,
  odometerReadings,
} from './forecast';
import { car as baseCar, fuelEntry, schedule as baseSchedule, visit } from '@/test/fixtures';

const today = '2026-11-28';
// Added long ago, so its own reading falls outside the 12-month window unless a test moves it.
const car: Car = { ...baseCar, odometer: 0, createdAt: '2020-01-01T00:00:00.000Z' };
const fill = (date: string, odometer: number, id = `${date}-${odometer}`): FuelEntry => ({
  ...fuelEntry,
  id,
  carId: car.id,
  date,
  odometer,
});
const service = (date: string, odometer: number | null): Visit => ({
  ...visit,
  id: `visit-${date}`,
  carId: car.id,
  date,
  odometer,
  items: [],
});
// 30 miles a day: 900 every 30 days.
const steady = [fill('2026-08-30', 60_000), fill('2026-09-29', 60_900), fill('2026-10-29', 61_800)];
const distanceOnly: ScheduleItem = {
  ...baseSchedule,
  carId: car.id,
  intervalMonths: null,
  firstDueDate: null,
  firstDueMiles: 70_000,
};

describe('odometerReadings', () => {
  it('collects dated visit and fill-up readings for this car only, oldest first', () => {
    const added = { ...car, odometer: 100, createdAt: '2026-01-05T08:00:00.000Z' };
    expect(
      odometerReadings(
        added,
        [service('2026-03-01', 1_000), service('2026-04-01', null)],
        [
          fill('2026-02-01', 500),
          { ...fill('2026-02-02', 9_999), carId: 'other-car' },
          fill('2026-12-01', 9_000),
        ],
        today,
      ),
    ).toEqual([
      { date: '2026-02-01', odometer: 500 },
      { date: '2026-03-01', odometer: 1_000 },
    ]);
  });
});

describe('drivingForecast', () => {
  it('returns null without readings or with a single reading', () => {
    expect(drivingForecast(car, [], [], today)).toBeNull();
    expect(drivingForecast(car, [], [fill('2026-10-01', 60_000)], today)).toBeNull();
  });

  it('averages the distance per day across fill-ups and service visits', () => {
    expect(
      drivingForecast(car, [service('2026-09-29', 60_900)], [steady[0], steady[2]], today),
    ).toEqual({ dailyDistance: 30, anchor: { date: '2026-10-29', odometer: 61_800 } });
  });

  it('counts readings on the same day once and still needs three reading days', () => {
    const sameDay = [
      fill('2026-09-01', 60_000),
      fill('2026-09-01', 60_100),
      fill('2026-10-15', 61_000),
    ];
    expect(drivingForecast(car, [], sameDay, today)).toBeNull();
    const enough = [...sameDay, fill('2026-10-31', 61_480)];
    // 60,100 → 61,480 over 60 days, using the higher same-day reading.
    expect(drivingForecast(car, [], enough, today)?.dailyDistance).toBe(23);
    expect(
      drivingForecast(car, [], [fill('2026-10-01', 1), fill('2026-10-01', 9)], today),
    ).toBeNull();
  });

  it('needs the readings to span at least 30 days', () => {
    const short = [
      fill('2026-11-01', 60_000),
      fill('2026-11-10', 60_300),
      fill('2026-11-25', 60_800),
    ];
    expect(drivingForecast(car, [], short, today)).toBeNull();
    expect(
      drivingForecast(car, [], [...short.slice(1), fill('2026-10-26', 59_700)], today),
    ).toMatchObject({ dailyDistance: 1_100 / 30 });
  });

  it('only uses readings from the last 12 months', () => {
    const old = [fill('2024-01-01', 10_000), fill('2024-06-01', 40_000)];
    expect(drivingForecast(car, [], [...old, fill('2026-10-01', 60_000)], today)).toBeNull();
    expect(drivingForecast(car, [], [...old, ...steady], today)?.dailyDistance).toBe(30);
  });

  it('skips backward, flat, and implausibly fast pairs from resets and typos', () => {
    const reset = [...steady, fill('2026-11-08', 200), fill('2026-11-28', 800)];
    // 1,800 over 60 days, then 600 over 20 days after the replaced odometer.
    expect(drivingForecast(car, [], reset, today)?.dailyDistance).toBe(30);
    const typo = [...steady, fill('2026-09-14', 160_000), fill('2026-11-28', 62_700)];
    // The typo's 100,000-mile jump is skipped, as is the drop after it.
    expect(drivingForecast(car, [], typo, today)?.dailyDistance).toBe(30);
    const flat = [
      fill('2026-08-30', 60_000),
      fill('2026-09-29', 60_000),
      fill('2026-10-29', 60_000),
    ];
    expect(drivingForecast(car, [], flat, today)).toBeNull();
    expect(
      drivingForecast(car, [], [fill('2026-09-01', 60_000), fill('2026-08-01', 61_000)], today),
    ).toBeNull();
  });

  it('allows a faster daily limit in kilometers', () => {
    const km = { ...car, distanceUnit: 'kilometers' as const };
    // 1,200 per day: plausible in kilometers, but over the 1,000-mile daily limit.
    const fast = [fill('2026-09-01', 0), fill('2026-09-16', 18_000), fill('2026-10-01', 36_000)];
    expect(drivingForecast(km, [], fast, today)?.dailyDistance).toBe(1_200);
    expect(drivingForecast(car, [], fast, today)).toBeNull();
  });

  it('never dates the vehicle odometer by when the car was added', () => {
    // Past visits entered after adding the car, then the odometer raised in Edit car.
    const added = { ...car, odometer: 63_000, createdAt: '2026-10-01T03:00:00.000Z' };
    const history = [service('2026-01-15', 50_000), service('2026-06-15', 55_000)];
    expect(drivingForecast(added, history, [], today)).toBeNull();
    expect(drivingForecast(added, [], steady, today)?.dailyDistance).toBe(30);
    // The raised odometer is the current reading, so the estimate starts from it today.
    expect(getDueItem(distanceOnly, added, [], today, steady).forecastDate).toBe('2027-07-20');
  });
});

describe('forecastDistanceDate', () => {
  const forecast = { dailyDistance: 30, anchor: { date: '2026-10-29', odometer: 61_800 } };

  it('projects from the latest reading and rounds up to a whole day', () => {
    // 8,200 miles at 30 a day is 273.3 days after Oct 29.
    expect(forecastDistanceDate(forecast, 70_000, 61_800, today)).toBe('2027-07-30');
  });

  it('returns null once the distance is reached', () => {
    expect(forecastDistanceDate(forecast, 61_800, 61_800, today)).toBeNull();
    expect(forecastDistanceDate(forecast, 60_000, 61_800, today)).toBeNull();
  });

  it('never forecasts a date before today', () => {
    expect(forecastDistanceDate(forecast, 62_000, 61_800, today)).toBe(today);
  });

  it('starts from today when the current odometer is above every dated reading', () => {
    expect(forecastDistanceDate(forecast, 65_000, 62_000, today)).toBe('2027-03-08');
  });

  it('drops forecasts too far out to trust', () => {
    const slow = { ...forecast, dailyDistance: 1 };
    expect(forecastDistanceDate(slow, 61_800 + MAX_FORECAST_DAYS + 40, 61_800, today)).toBeNull();
  });
});

describe('due item forecasts', () => {
  it('adds an approximate date to distance-based tasks', () => {
    const item = getDueItem(distanceOnly, car, [], today, steady);
    expect(item).toMatchObject({ status: 'later', dueMiles: 70_000, forecastDate: '2027-07-30' });
    expect(approximateDueDate(item)).toBe('2027-07-30');
  });

  it('has no forecast without enough readings', () => {
    expect(getDueItem(distanceOnly, car, [], today, [steady[2]]).forecastDate).toBeNull();
    expect(getDueItem(distanceOnly, car, [], today).forecastDate).toBeNull();
  });

  it('uses the earlier of the distance estimate and the due date', () => {
    const soonerDate = getDueItem(
      { ...distanceOnly, firstDueDate: '2027-03-01' },
      car,
      [],
      today,
      steady,
    );
    expect(soonerDate.forecastDate).toBe('2027-03-01');
    expect(approximateDueDate(soonerDate)).toBeNull();
    const laterDate = getDueItem(
      { ...distanceOnly, firstDueDate: '2027-12-01' },
      car,
      [],
      today,
      steady,
    );
    expect(laterDate.forecastDate).toBe('2027-07-30');
    expect(approximateDueDate(laterDate)).toBe('2027-07-30');
  });

  it('follows repeats from the last linked visit', () => {
    const repeat = { ...distanceOnly, intervalMiles: 5_000, intervalMonths: 12 };
    const done = {
      ...service('2026-10-29', 61_800),
      items: [{ ...visit.items[0], scheduleItemId: repeat.id }],
    };
    // Due at 66,800 or Oct 29, 2027; 5,000 miles at 30 a day lands Apr 14, 2027.
    expect(getDueItem(repeat, car, [done], today, steady)).toMatchObject({
      dueMiles: 66_800,
      dueDate: '2027-10-29',
      forecastDate: '2027-04-14',
    });
  });

  it('has no forecast for overdue, completed, setup, or time-only tasks', () => {
    const overdue = getDueItem({ ...distanceOnly, firstDueMiles: 61_000 }, car, [], today, steady);
    expect(overdue).toMatchObject({ status: 'due', forecastDate: null });
    const pastDate = getDueItem(
      { ...distanceOnly, firstDueDate: '2026-11-01' },
      car,
      [],
      today,
      steady,
    );
    expect(pastDate).toMatchObject({ status: 'due', forecastDate: null });
    const timeOnly = {
      ...distanceOnly,
      intervalMiles: null,
      firstDueMiles: null,
      firstDueDate: '2027-01-01',
    };
    expect(getDueItem(timeOnly, car, [], today, steady).forecastDate).toBeNull();
    const oneTime = { ...distanceOnly, intervalMiles: null, intervalMonths: null };
    const done = {
      ...service('2026-10-01', 61_000),
      items: [{ ...visit.items[0], scheduleItemId: oneTime.id }],
    };
    expect(getDueItem(oneTime, car, [done], today, steady)).toMatchObject({
      status: 'completed',
      forecastDate: null,
    });
  });

  it('forecasts kilometer vehicles in kilometers', () => {
    const km = { ...car, distanceUnit: 'kilometers' as const };
    // 48 km a day: 1,440 every 30 days; 10,000 km to go from Oct 29.
    const readings = [
      fill('2026-08-30', 90_000),
      fill('2026-09-29', 91_440),
      fill('2026-10-29', 92_880),
    ];
    const item = getDueItem({ ...distanceOnly, firstDueMiles: 102_880 }, km, [], today, readings);
    expect(item.forecastDate).toBe('2027-05-26');
  });

  it('estimates each car from its own readings in getAllDue', () => {
    const other = { ...car, id: 'other-car' };
    const items = getAllDue(
      [car, other],
      [distanceOnly, { ...distanceOnly, id: 'other-task', carId: other.id }],
      [],
      today,
      steady,
    );
    expect(items.map((item) => [item.car.id, item.forecastDate])).toEqual([
      [car.id, '2027-07-30'],
      [other.id, null],
    ]);
  });
});

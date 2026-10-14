import { expect, it } from 'vitest';
import { makeStarterSchedules, type DistanceUnit } from './model';

it.each([
  ['miles', [7500, 6000, 50000, 20000, 15000]],
  ['kilometers', [12000, 10000, 80000, 30000, 25000]],
] as const)('creates the five common tasks with %s defaults', (unit, distances) => {
  const schedules = makeStarterSchedules('car', undefined, unit);
  expect(schedules.map((task) => task.name)).toEqual([
    'Oil change',
    'Tire rotation',
    'Tire replacement',
    'Engine air filter',
    'Cabin air filter',
  ]);
  expect(schedules.map((task) => task.intervalMonths)).toEqual([12, 6, 60, 18, 12]);
  expect(schedules.map((task) => task.intervalMiles)).toEqual(distances);
  expect(schedules.every((task) => task.carId === 'car' && task.isActive)).toBe(true);
});

it('uses mile defaults when no distance unit is supplied', () => {
  expect(makeStarterSchedules('car')[0].intervalMiles).toBe(7500);
});

it.each<DistanceUnit>(['miles', 'kilometers'])(
  'keeps defaults with translated names in %s',
  (unit) => {
    const names = [
      'Cambio de aceite',
      'Rotación',
      'Neumáticos',
      'Filtro del motor',
      'Filtro de cabina',
    ];
    const schedules = makeStarterSchedules('car', names, unit);
    expect(schedules.map((task) => task.name)).toEqual(names);
    expect(schedules.map((task) => task.intervalMiles)).toEqual(
      makeStarterSchedules('car', undefined, unit).map((task) => task.intervalMiles),
    );
  },
);

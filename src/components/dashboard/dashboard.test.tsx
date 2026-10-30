import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { messages, type Locale } from '@/i18n/config';
import { getAllDue } from '@/lib/maintenance/due';
import { initializeSnapshotSchedules } from '@/lib/maintenance/schedule-defaults';
import { carPath } from '@/lib/navigation/garage-routes';
import type { ScheduleItem, Visit } from '@/lib/garage/model';
import { car, schedule, visit } from '@/test/fixtures';
import { Dashboard } from './dashboard';

const intervalOnly = { ...schedule, firstDueMiles: null, firstDueDate: null };
const unconfigured = { ...intervalOnly, intervalMiles: null, intervalMonths: null };

function dashboard(schedules: ScheduleItem[], visits: Visit[] = [], locale: Locale = 'en') {
  const snapshot = initializeSnapshotSchedules(
    { cars: [car], schedules, visits, fuelEntries: [] },
    '2026-10-13',
  );
  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">
      <Dashboard
        cars={[car]}
        visits={visits}
        allDue={getAllDue(snapshot.cars, snapshot.schedules, snapshot.visits, '2026-10-13')}
        onAddCar={() => {}}
        onAddVisit={() => {}}
      />
    </NextIntlClientProvider>
  );
}

describe('dashboard setup guidance', () => {
  it.each([
    [
      'en',
      '1 task needs a repeat interval or a one-time due point.',
      '2 tasks need a repeat interval or a one-time due point.',
    ],
    [
      'es',
      '1 tarea necesita un intervalo de repetición o un vencimiento único.',
      '2 tareas necesitan un intervalo de repetición o un vencimiento único.',
    ],
  ] as const)(
    'explains missing due points and links affected tasks in %s',
    (locale, singular, plural) => {
      const view = render(dashboard([unconfigured], [], locale));
      expect(screen.getByText(singular)).toBeDefined();
      expect(screen.getByRole('link', { name: /Oil change/ }).getAttribute('href')).toBe(
        carPath(car.id),
      );

      view.rerender(
        dashboard(
          [unconfigured, { ...unconfigured, id: 'filter', name: 'Cabin air filter' }],
          [],
          locale,
        ),
      );
      expect(screen.getByText(plural)).toBeDefined();
      expect(screen.getByRole('link', { name: /Cabin air filter/ }).getAttribute('href')).toBe(
        carPath(car.id),
      );
    },
  );

  it.each([
    ['repeat intervals alone', intervalOnly, []],
    ['a first due date', { ...intervalOnly, firstDueDate: '2027-12-01' }, []],
    ['a first due reading', schedule, []],
    ['a linked service baseline', intervalOnly, [visit]],
    [
      'a completed one-time task',
      { ...intervalOnly, intervalMiles: null, intervalMonths: null },
      [visit],
    ],
    ['an inactive task', { ...intervalOnly, isActive: false }, []],
  ] as const)('hides setup guidance with %s', (_name, task, visits) => {
    const { container } = render(dashboard([task], [...visits]));
    expect(container.querySelector('.setup-note')).toBeNull();
  });

  it('removes the warning when a missing due point is saved', () => {
    const view = render(dashboard([unconfigured]));
    expect(screen.getByRole('link', { name: /Oil change/ })).toBeDefined();
    view.rerender(dashboard([intervalOnly]));
    expect(view.container.querySelector('.setup-note')).toBeNull();
    expect(screen.queryByRole('link', { name: /Oil change/ })).toBeNull();
    expect(screen.getByText('All caught up')).toBeDefined();
  });

  it('retains a mileage target when a service visit has no odometer reading', () => {
    const view = render(
      dashboard([{ ...schedule, intervalMonths: null }], [{ ...visit, odometer: null }]),
    );
    expect(view.container.querySelector('.setup-note')).toBeNull();
  });
});

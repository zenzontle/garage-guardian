import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { getAllDue } from '@/lib/maintenance/due';
import { getRenewals } from '@/lib/expenses/expenses';
import { fuelEconomy } from '@/lib/fuel/economy';
import { LocalRepository } from '@/lib/garage/repository';
import { car, expense, fuelEntry, schedule } from '@/test/fixtures';
import { Dashboard } from './dashboard';
import { VisitModal } from '../visits/visit-modal';
import { ExpenseModal } from '../expenses/expense-modal';
import { FuelTrend } from '../fuel/fuel-trend';

const today = '2026-10-13';
// Due by odometer: the car is past the task's first due distance.
const dueCar = { ...car, odometer: 6000 };
const wrap = (children: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
    {children}
  </NextIntlClientProvider>
);

describe('dashboard actions', () => {
  it('logs a due task and a renewal from their rows', async () => {
    const onLogTask = vi.fn();
    const onLogRenewal = vi.fn();
    const renewal = { ...expense, renewsOn: '2026-10-20' };
    render(
      wrap(
        <Dashboard
          cars={[dueCar]}
          visits={[]}
          expenses={[renewal]}
          allDue={getAllDue([dueCar], [schedule], [], today)}
          renewals={getRenewals([dueCar], [renewal], today)}
          onAddCar={() => {}}
          onAddVisit={() => {}}
          onLogTask={onLogTask}
          onLogRenewal={onLogRenewal}
        />,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Log Oil change' }));
    expect(onLogTask).toHaveBeenCalledWith(expect.objectContaining({ schedule }));
    expect(screen.getByText('Insurance renewal')).toBeTruthy();
    expect(screen.getByText(/Renews Oct 20, 2026/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Log Insurance renewal' }));
    expect(onLogRenewal).toHaveBeenCalledWith(expect.objectContaining({ expense: renewal }));
    // One due task, one upcoming renewal.
    const attention = screen
      .getByRole('heading', { name: 'What needs attention' })
      .closest('section')!;
    expect(within(attention).getByText('2')).toBeTruthy();
  });

  it('includes fill-ups and other costs in year-to-date spending', () => {
    const year = String(new Date().getFullYear());
    render(
      wrap(
        <Dashboard
          cars={[car]}
          visits={[]}
          fuelEntries={[{ ...fuelEntry, date: `${year}-01-02` }]}
          expenses={[{ ...expense, date: `${year}-01-01`, renewsOn: null }]}
          allDue={[]}
          onAddCar={() => {}}
          onAddVisit={() => {}}
        />,
      ),
    );
    expect(screen.getByText('USD 454.59')).toBeTruthy();
  });
});

it('starts a visit logged from a task with that task completed', async () => {
  const onSave = vi.fn(async () => {});
  render(
    wrap(
      <VisitModal
        carId={car.id}
        scheduleId={schedule.id}
        cars={[car]}
        visits={[]}
        schedules={[schedule]}
        repository={new LocalRepository()}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    ),
  );
  expect(screen.getByLabelText('Service item name')).toHaveProperty('value', 'Oil change');
  expect(screen.getByLabelText('Choose scheduled task')).toHaveProperty('value', schedule.id);
  await userEvent.click(screen.getByRole('button', { name: 'Save visit' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ name: 'Oil change', scheduleItemId: schedule.id })],
      }),
      [],
    ),
  );
});

describe('cost form', () => {
  it('starts the next payment of a renewal from the last one', async () => {
    const onSave = vi.fn(async () => {});
    render(
      wrap(
        <ExpenseModal
          next={{ ...expense, currency: 'CAD' }}
          cars={[car]}
          onClose={vi.fn()}
          onSave={onSave}
        />,
      ),
    );
    expect(screen.getByLabelText('Category')).toHaveProperty('value', 'insurance');
    expect(screen.getByLabelText(/Description/)).toHaveProperty('value', '6-month policy');
    expect(screen.getByLabelText('Receipt currency')).toHaveProperty('value', 'CAD');
    fireEvent.change(screen.getAllByLabelText('Amount (CAD)')[0], { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText(/Renews on/), { target: { value: '2027-06-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save cost' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          carId: car.id,
          category: 'insurance',
          totalCostCents: 40000,
          currency: 'CAD',
          renewsOn: '2027-06-01',
        }),
      ),
    );
  });

  it('rejects a renewal date that is not after the cost date', async () => {
    const onSave = vi.fn(async () => {});
    render(wrap(<ExpenseModal cars={[car]} onClose={vi.fn()} onSave={onSave} />));
    fireEvent.change(screen.getAllByLabelText('Amount (USD)')[0], { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-01' } });
    const renewsOn = screen.getByLabelText(/Renews on/);
    // The picker starts the day after the cost.
    expect(renewsOn).toHaveProperty('min', '2026-09-02');
    fireEvent.change(renewsOn, { target: { value: '2026-09-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save cost' }));
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('fuel economy trend', () => {
  const fills = [0, 300, 600, 900].map((odometer, index) => ({
    ...fuelEntry,
    id: `fill-${index}`,
    date: `2026-0${index + 6}-01`,
    odometer,
  }));

  it('describes each measured tank and the average', () => {
    render(wrap(<FuelTrend car={car} entries={fills} economy={fuelEconomy(car, fills)} />));
    expect(
      screen.getByRole('img', {
        name: 'Daily driver fuel economy across 3 tanks, from Jul 1, 2026 to Sep 1, 2026. Average 30.0 mpg.',
      }),
    ).toBeTruthy();
  });

  it('asks for more tanks before drawing a trend', () => {
    const two = fills.slice(0, 2);
    render(wrap(<FuelTrend car={car} entries={two} economy={fuelEconomy(car, two)} />));
    expect(screen.getByText('Log at least two measured tanks to see a trend.')).toBeTruthy();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { car, fuelEntry, visit } from '@/test/fixtures';
import { LocalRepository } from '@/lib/garage/repository';
import type { FuelEntry } from '@/lib/garage/model';
import { FuelModal } from './fuel-modal';

function renderModal(props: Partial<Parameters<typeof FuelModal>[0]> = {}) {
  const onSave = vi.fn(async (entry: FuelEntry) => {
    void entry;
  });
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <FuelModal
        cars={[car]}
        visits={[]}
        fuelEntries={[]}
        repository={new LocalRepository()}
        onClose={vi.fn()}
        onSave={onSave}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onSave };
}
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

it('calculates the total from volume and price, and lets a typed total stand', () => {
  renderModal();
  fireEvent.change(field('Volume'), { target: { value: '12.345' } });
  fireEvent.change(field('Price per gal (USD)'), { target: { value: '3.459' } });
  expect(field('Total (USD)').value).toBe('42.70');
  // Typing over the calculated total keeps it, without changing volume or price.
  fireEvent.change(field('Total (USD)'), { target: { value: '42.71' } });
  expect(field('Volume').value).toBe('12.345');
  expect(field('Price per gal (USD)').value).toBe('3.459');
  expect(field('Total (USD)').value).toBe('42.71');
});

it('calculates the price from volume and total, and the volume from price and total', () => {
  renderModal();
  fireEvent.change(field('Volume'), { target: { value: '5' } });
  fireEvent.change(field('Total (USD)'), { target: { value: '17.50' } });
  expect(field('Price per gal (USD)').value).toBe('3.5');
  // The last two typed amounts win: price and total now calculate the volume.
  fireEvent.change(field('Price per gal (USD)'), { target: { value: '3.5' } });
  fireEvent.change(field('Total (USD)'), { target: { value: '35' } });
  expect(field('Volume').value).toBe('10');
});

it('starts from the latest odometer and the last fill-up for the car', () => {
  renderModal({
    visits: [{ ...visit, odometer: 300 }],
    fuelEntries: [
      { ...fuelEntry, id: 'older', date: '2026-01-01', odometer: 200, station: 'Old' },
      {
        ...fuelEntry,
        volumeUnit: 'liters',
        fuelType: 'premium',
        currency: 'MXN',
        station: 'Pemex Centro',
        odometer: 400,
      },
    ],
  });
  expect(field('Odometer (miles)').value).toBe('400');
  expect((screen.getByLabelText('Volume unit') as HTMLSelectElement).value).toBe('liters');
  expect((screen.getByRole('combobox', { name: 'Gas type' }) as HTMLSelectElement).value).toBe(
    'premium',
  );
  expect((screen.getByLabelText('Receipt currency') as HTMLSelectElement).value).toBe('MXN');
  expect((screen.getByRole('combobox', { name: /Station/ }) as HTMLInputElement).value).toBe(
    'Pemex Centro',
  );
  expect(screen.getByLabelText('Price per L (MXN)')).toBeTruthy();
});

it('defaults kilometer cars to liters and the home currency without a previous fill-up', () => {
  renderModal({
    cars: [{ ...car, distanceUnit: 'kilometers' }],
    homeCurrency: 'CAD',
  });
  expect((screen.getByLabelText('Volume unit') as HTMLSelectElement).value).toBe('liters');
  expect((screen.getByLabelText('Receipt currency') as HTMLSelectElement).value).toBe('CAD');
  expect((screen.getByRole('combobox', { name: 'Gas type' }) as HTMLSelectElement).value).toBe(
    'regular',
  );
});

it('requires a volume and an odometer in order with other fill-ups', async () => {
  const { onSave } = renderModal({
    fuelEntries: [{ ...fuelEntry, id: 'earlier', date: '2026-01-01', odometer: 5000 }],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Save fill-up' }));
  expect(screen.getByRole('alert').textContent).toBe(en.errors.fuelFields);
  fireEvent.change(field('Odometer (miles)'), { target: { value: '4000' } });
  fireEvent.change(field('Volume'), { target: { value: '10' } });
  fireEvent.change(field('Total (USD)'), { target: { value: '30' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save fill-up' }));
  expect(screen.getByRole('alert').textContent).toBe(en.errors.fuelOdometerOrder);
  expect(onSave).not.toHaveBeenCalled();
});

it('saves a partial fill-up with integer amounts', async () => {
  const repository = new LocalRepository();
  await repository.saveCar(car);
  const { onSave } = renderModal({ repository });
  onSave.mockImplementation((entry) => repository.saveFuelEntry(entry));
  fireEvent.change(field('Odometer (miles)'), { target: { value: '1200' } });
  fireEvent.change(field('Volume'), { target: { value: '12.345' } });
  fireEvent.change(field('Price per gal (USD)'), { target: { value: '3.459' } });
  await userEvent.click(screen.getByRole('checkbox', { name: /Filled the tank/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save fill-up' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect((await repository.load()).fuelEntries[0]).toMatchObject({
    carId: car.id,
    odometer: 1200,
    volumeMilli: 12345,
    volumeUnit: 'gallons',
    unitPriceMilli: 3459,
    totalCostCents: 4270,
    currency: 'USD',
    isFullTank: false,
    missedPrevious: false,
  });
});

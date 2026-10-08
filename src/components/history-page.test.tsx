import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import { car, visit } from '@/test/fixtures';
import { LocalRepository } from '@/lib/repository';
import type { Car, Visit } from '@/lib/model';
import { HistoryPage } from './history-page';

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ''));
const metric: Car = { ...car, id: 'metric', name: 'Metric driver', distanceUnit: 'kilometers' };
const later: Visit = {
  ...visit,
  id: 'later',
  carId: metric.id,
  date: '2026-10-01',
  odometer: 1600,
  totalCostCents: 5000,
  items: [],
  notes: '',
  provider: '',
};
function setup(visits = [{ ...visit, odometer: 1000 }, later]) {
  const repository = new LocalRepository();
  const onEdit = vi.fn(),
    onDelete = vi.fn();
  const props = { cars: [car, metric], visits, repository, onAdd: vi.fn(), onEdit, onDelete };
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <HistoryPage {...props} />
    </NextIntlClientProvider>,
  );
  return {
    ...view,
    props,
    repository,
    onEdit,
    onDelete,
    get cards() {
      return within(screen.getByRole('list', { name: 'Service history' }));
    },
    get table() {
      return within(screen.getByRole('table'));
    },
    user: userEvent.setup(),
  };
}

it('shows all visit facts, keeps both presentations sorted by equivalent distance, and shares expansion by visit', async () => {
  const { cards, table, user } = setup();
  await user.selectOptions(screen.getByLabelText('Sort service history'), 'odometer_high');
  const entries = cards.getAllByRole('listitem');
  expect(entries[0].textContent).toContain('1,000 mi');
  expect(entries[0].textContent).toContain('Dealer');
  expect(entries[0].textContent).toContain('$150.00');
  expect(entries[1].textContent).toContain('1,600 km');
  expect(entries[1].textContent).toContain('Service visit');
  expect(table.getAllByRole('row')[1].textContent).toContain('1,000 mi');
  const cardToggle = cards.getByRole('button', { name: 'Oil change' });
  const rowToggle = table.getByRole('button', { name: 'Oil change' });
  expect(cardToggle.getAttribute('aria-controls')).not.toBe(
    rowToggle.getAttribute('aria-controls'),
  );
  const detail = document.getElementById(cardToggle.getAttribute('aria-controls')!)!;
  expect(detail.hidden).toBe(true);
  await user.click(cardToggle);
  expect(detail.hidden).toBe(false);
  expect(rowToggle.getAttribute('aria-expanded')).toBe('true');
  expect(cards.getByText('Checked')).toBeDefined();
  expect(table.getByText('Checked')).toBeDefined();
  await user.selectOptions(screen.getByLabelText('Sort service history'), 'oldest');
  expect(rowToggle.getAttribute('aria-expanded')).toBe('true');
  await user.click(rowToggle);
  expect(cardToggle.getAttribute('aria-expanded')).toBe('false');
});

it('uses the same filters for cards, table, counts, and CSV export', async () => {
  const { cards, table, user } = setup();
  let csv!: Blob;
  const createObjectURL = vi.fn((blob: Blob) => {
    csv = blob;
    return 'blob:csv';
  });
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await user.selectOptions(screen.getByLabelText('Filter by car'), car.id);
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });
  await user.type(screen.getByLabelText('Search service history'), 'Dealer');
  expect(cards.getAllByRole('listitem')).toHaveLength(1);
  expect(table.getAllByRole('row')).toHaveLength(2);
  expect(screen.getByText('Showing 1 of 2 visits')).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Export CSV' }));
  expect(await csv.text()).toContain('Daily driver');
  expect(await csv.text()).not.toContain('Metric driver');
  expect(click).toHaveBeenCalledOnce();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv');
  await user.type(screen.getByLabelText('Search service history'), 'no-match');
  expect(screen.getByText('No matching records')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Export CSV' })).toHaveProperty('disabled', true);
});

it('connects edit and delete actions to the corresponding visit in both presentations', async () => {
  const { cards, table, user, onEdit, onDelete } = setup([visit]);
  await user.click(cards.getByRole('button', { name: 'Edit visit' }));
  await user.click(cards.getByRole('button', { name: 'Delete visit' }));
  await user.click(table.getByRole('button', { name: 'Edit visit' }));
  await user.click(table.getByRole('button', { name: 'Delete visit' }));
  expect(onEdit).toHaveBeenCalledTimes(2);
  expect(onEdit).toHaveBeenLastCalledWith(visit);
  expect(onDelete).toHaveBeenCalledTimes(2);
  expect(onDelete).toHaveBeenLastCalledWith(visit);
});

it('downloads photos and localizes an existing photo error without losing expansion', async () => {
  const photo = { id: 'photo', name: 'receipt.webp', path: 'photo', contentType: 'image/webp' };
  const { cards, table, user, repository, rerender, props } = setup([
    { ...visit, photos: [photo] },
  ]);
  const photoUrl = vi
    .spyOn(repository, 'photoUrl')
    .mockResolvedValueOnce('https://example.com/receipt');
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await user.click(cards.getByRole('button', { name: 'Oil change' }));
  await user.click(cards.getByRole('button', { name: 'receipt.webp' }));
  expect(photoUrl).toHaveBeenCalledWith(photo);
  expect(click).toHaveBeenCalledOnce();
  photoUrl.mockRejectedValue(new Error('Missing photo'));
  await user.click(cards.getByRole('button', { name: 'receipt.webp' }));
  await cards.findByRole('alert');
  rerender(
    <NextIntlClientProvider locale="es" messages={es}>
      <HistoryPage {...props} />
    </NextIntlClientProvider>,
  );
  expect(cards.getByRole('alert').textContent).toContain('foto');
  expect(table.getByRole('button', { name: 'Oil change' }).getAttribute('aria-expanded')).toBe(
    'true',
  );
});

it('handles an empty history and records whose vehicle is unavailable', () => {
  const { rerender, props } = setup([]);
  expect(screen.getByText('No service history yet')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Export CSV' })).toHaveProperty('disabled', true);
  rerender(
    <NextIntlClientProvider locale="en" messages={en}>
      <HistoryPage {...props} visits={[{ ...visit, carId: 'missing' }]} />
    </NextIntlClientProvider>,
  );
  const cards = within(screen.getByRole('list', { name: 'Service history' }));
  expect(cards.getByText('Unknown')).toBeDefined();
});

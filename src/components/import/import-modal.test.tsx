import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
import { car, expense } from '@/test/fixtures';
import { EMPTY_SNAPSHOT, type Expense, type Snapshot } from '@/lib/garage/model';
import { ImportModal } from './import-modal';

const snapshot: Snapshot = { ...EMPTY_SNAPSHOT, cars: [car], expenses: [expense] };
const csv = [
  'Date,Car,Category,Amount',
  '2026-09-01,Daily driver,Insurance,420',
  '2026-09-15,Daily driver,Tolls,12.50',
  '2026-09-16,Weekend car,Tolls,3',
].join('\n');

type OnImport = (records: Expense[], onSaved: (count: number) => void) => Promise<void>;

function renderModal(locale: 'en' | 'es' = 'en', onImport = vi.fn<OnImport>(async () => {})) {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : es}>
      <ImportModal
        kind="expense"
        snapshot={snapshot}
        onClose={vi.fn()}
        onImport={onImport}
        homeCurrency="USD"
      />
    </NextIntlClientProvider>,
  );
  return { onImport };
}
const upload = (text: string, name = 'costs.csv') =>
  userEvent.upload(screen.getByLabelText(/CSV file|Archivo CSV/), new File([text], name));

it('previews a file, skips saved and broken rows, and imports the rest in order', async () => {
  const onImport = vi.fn(async (records: Expense[], onSaved: (count: number) => void) => {
    records.forEach((_, index) => onSaved(index + 1));
  });
  renderModal('en', onImport);
  expect(
    (screen.getByRole('button', { name: 'Nothing to import' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await upload(csv);
  const summary = screen.getByText('Ready to import').closest('dl')!;
  expect(
    within(summary)
      .getAllByRole('definition')
      .map((item) => item.textContent),
  ).toEqual(['1', '1', '1']);
  const problems = screen.getByRole('region', { name: 'Rows to review' });
  expect(problems.textContent).toContain('Row 2');
  expect(problems.textContent).toContain('Matches a saved record or an earlier row');
  expect(problems.textContent).toContain('Row 4');
  expect(problems.textContent).toContain('No vehicle in your garage is named “Weekend car”.');

  await userEvent.click(screen.getByRole('button', { name: 'Import 1 record' }));
  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
  expect(onImport.mock.calls[0][0]).toMatchObject([
    { carId: car.id, category: 'tolls', totalCostCents: 1250, currency: 'USD' },
  ]);
});

it('can include rows that look already saved', async () => {
  const { onImport } = renderModal();
  await upload(csv);
  await userEvent.click(screen.getByLabelText('Also import rows that look already saved'));
  await userEvent.click(screen.getByRole('button', { name: 'Import 2 records' }));
  await waitFor(() => expect(onImport).toHaveBeenCalled());
  expect(onImport.mock.calls[0][0]).toHaveLength(2);
});

it('asks for missing columns and uses the chosen vehicle when the file has none', async () => {
  renderModal();
  await upload('Fecha,Monto\n2026-09-15,10');
  expect(screen.getByRole('alert').textContent).toContain('Choose a column for: Category.');
  expect(
    (screen.getByRole('combobox', { name: 'Vehicle for these records' }) as HTMLSelectElement)
      .value,
  ).toBe(car.id);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Category/ }), 'Monto');
  // Moving the column from the total leaves the total unmapped.
  expect((screen.getByRole('combobox', { name: /^Total/ }) as HTMLSelectElement).value).toBe('');
});

it('reads day-first dates in Spanish and reports unreadable files', async () => {
  const { onImport } = renderModal('es');
  await upload('Fecha;Vehículo;Categoría;Monto\n25/09/2026;Daily driver;Casetas;30');
  expect(
    (screen.getByRole('combobox', { name: 'Fechas escritas como 3/4/2026' }) as HTMLSelectElement)
      .value,
  ).toBe('dmy');
  await userEvent.click(screen.getByRole('button', { name: 'Importar 1 registro' }));
  await waitFor(() => expect(onImport).toHaveBeenCalled());
  expect(onImport.mock.calls[0][0]).toMatchObject([{ date: '2026-09-25', category: 'tolls' }]);

  await upload('Fecha,Monto\n');
  expect(screen.getByRole('alert').textContent).toContain(
    'Este archivo no tiene filas debajo de los nombres de columna.',
  );
});

it('reports how many records were saved when an import stops', async () => {
  renderModal(
    'en',
    vi.fn(async (_records: Expense[], onSaved: (count: number) => void) => {
      onSaved(1);
      throw new Error('offline');
    }),
  );
  await upload(
    'Date,Car,Category,Amount\n2026-09-15,Daily driver,Tolls,1\n2026-09-16,Daily driver,Tolls,2',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Import 2 records' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    '1 of 2 records were saved before the import stopped.',
  );
});

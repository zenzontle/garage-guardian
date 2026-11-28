import { expect, test } from '@playwright/test';
import { addCar, openGarage, toast } from './support/garage';

const csv = (rows: string[]) => ({
  name: 'fill-ups.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(rows.join('\r\n')),
});

test('imports fill-ups from a spreadsheet and skips them when imported again', async ({ page }) => {
  await openGarage(page);
  await addCar(page, {
    name: 'Daily Civic',
    year: 2019,
    make: 'Honda',
    model: 'Civic',
    odometer: 1000,
  });
  const file = csv([
    'Fecha;Vehículo;Odómetro;Galones;Precio;Total',
    '15/08/2026;daily civic;"1,200";10;3.50;',
    '01/09/2026;Daily Civic;1500;10;;36.00',
    '02/09/2026;Weekend Truck;900;8;3;',
  ]);

  await page.goto('/fuel');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import fill-ups' });
  await dialog.getByLabel('CSV file').setInputFiles(file);
  await expect(dialog.getByLabel('Dates written like 3/4/2026')).toHaveValue('dmy');
  await expect(dialog.getByRole('region', { name: 'Rows to review' })).toContainText(
    'No vehicle in your garage is named “Weekend Truck”.',
  );
  await dialog.getByRole('button', { name: 'Import 2 records' }).click();
  await expect(dialog).toBeHidden();
  await expect(toast(page, '2 records imported.')).toBeVisible();
  await expect(page.getByText('Showing 2 of 2 fill-ups')).toBeVisible();

  await page.getByRole('button', { name: 'Import CSV' }).click();
  await dialog.getByLabel('CSV file').setInputFiles(file);
  await expect(dialog.getByRole('button', { name: 'Nothing to import' })).toBeDisabled();
  await expect(dialog.locator('.import-summary dd')).toHaveText(['0', '2', '1']);
});

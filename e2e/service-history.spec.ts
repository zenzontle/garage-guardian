import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addCar, logService, openGarage, receiptPhoto, toast } from './support/garage';

test('logs a visit with a photo, then filters, exports and deletes it', async ({ page }) => {
  await openGarage(page);
  const civicId = await addCar(page, {
    name: 'Daily Civic',
    year: 2019,
    make: 'Honda',
    model: 'Civic',
    odometer: 42000,
  });
  await logService(page, {
    items: [
      { task: 'Oil change', cost: 60 },
      { name: 'Wiper blades', cost: 25 },
    ],
    total: 120,
    odometer: 42100,
    provider: 'Downtown Honda',
    photo: receiptPhoto,
  });
  await addCar(page, {
    name: 'Road Trip Van',
    year: 2022,
    make: 'Toyota',
    model: 'Sienna',
    odometer: 80000,
  });
  await logService(page, { items: [{ name: 'Inspection' }], total: 40 });

  await page.goto('/history');
  await expect(page.getByText('Showing 2 of 2 visits')).toBeVisible();
  await page.getByLabel('Filter by car').selectOption({ label: 'Daily Civic' });
  await expect(page).toHaveURL(`/history?car=${civicId}`);
  await expect(page.getByText('Showing 1 of 2 visits')).toBeVisible();

  const visit = page.getByRole('button', { name: 'Oil change, Wiper blades' });
  await visit.click();
  await expect(visit).toHaveAttribute('aria-expanded', 'true');
  const detail = page.locator(`[id="${await visit.getAttribute('aria-controls')}"]`);
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(/Oil change \(USD\s60\.00\) · Wiper blades \(USD\s25\.00\)/);
  await expect(detail.getByRole('button', { name: 'receipt.webp' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('garage-guardian-service-history.csv');
  const lines = (await readFile(await file.path(), 'utf8')).replace(/^\uFEFF/, '').split('\r\n');
  expect(lines[0]).toBe(
    'Date,Car,Odometer,Distance unit,Provider,Items,Original total,Original item costs,Notes,' +
      'Photo count,Original currency,Reporting currency,Converted total,Conversion source,Rate date',
  );
  expect(lines[1]).toMatch(
    /^\d{4}-\d{2}-\d{2},Daily Civic,42100,mi,Downtown Honda,Oil change; Wiper blades,120\.00,Oil change: 60\.00; Wiper blades: 25\.00,,1,USD,USD,120\.00,same-currency,$/,
  );
  expect(lines.slice(2)).toEqual(['']);

  await page.getByRole('button', { name: 'Delete visit' }).click();
  const confirm = page.getByRole('alertdialog', { name: /^Delete Daily Civic — / });
  await expect(confirm).toContainText('This permanently deletes the service visit and its photos.');
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(toast(page, 'Service visit deleted.')).toBeVisible();
  await expect(page.getByText('No matching records')).toBeVisible();
  await expect(page.getByText('Showing 0 of 1 visit')).toBeVisible();
});

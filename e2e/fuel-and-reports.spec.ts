import { expect, test } from '@playwright/test';
import { addCar, addFillUp, logService, openGarage, statCard } from './support/garage';

test('tracks fuel economy, keeps the odometer current and reports spending', async ({ page }) => {
  await openGarage(page);
  const civicId = await addCar(page, {
    name: 'Daily Civic',
    year: 2019,
    make: 'Honda',
    model: 'Civic',
    odometer: 10000,
  });
  await addFillUp(page, { odometer: 10000, volume: 10, price: 3.5 });
  await addFillUp(page, { odometer: 10300, volume: 10, price: 3.5 });
  await expect(page.getByText('10,300 mi current odometer')).toBeVisible();
  await logService(page, { items: [{ name: 'Oil change' }], total: 120 });

  await addCar(page, {
    name: 'Road Trip Van',
    year: 2022,
    make: 'Toyota',
    model: 'Sienna',
    odometer: 80000,
    unit: 'kilometers',
  });
  await addFillUp(page, { odometer: 80000, volume: 40, price: 1.5 });
  await logService(page, { items: [{ name: 'Inspection' }], total: 80 });

  await page.goto('/fuel');
  // 300 miles on the 10 gallons pumped between the two full tanks.
  await expect(statCard(page, 'Daily Civic').locator('strong')).toHaveText('30.0 mpg');
  await expect(page.getByText('Showing 3 of 3 fill-ups')).toBeVisible();

  await page.goto(`/fuel?car=${civicId}`);
  await expect(page.getByLabel('Filter by vehicle')).toHaveValue(civicId);
  await expect(page.getByText('Showing 2 of 3 fill-ups')).toBeVisible();

  // A renewal inside the vehicle's 30-day window is a reminder until the next payment.
  const renewal = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await page.goto('/costs');
  await page.getByRole('button', { name: 'Log cost' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log cost' });
  await dialog.getByLabel(/^Vehicle/).selectOption({ label: 'Daily Civic' });
  await dialog.getByLabel('Category').selectOption({ label: 'Insurance' });
  await dialog.getByLabel(/^Amount/).fill('50.00');
  await dialog.getByLabel(/^Renews on/).fill(renewal);
  await dialog.getByRole('button', { name: 'Save cost' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Showing 1 of 1 cost')).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Log Insurance renewal' }).click();
  const next = page.getByRole('dialog', { name: 'Log cost' });
  await expect(next.getByLabel('Category')).toHaveValue('insurance');
  await next.getByLabel(/^Amount/).fill('10.00');
  await next.getByRole('button', { name: 'Save cost' }).click();
  await expect(next).toBeHidden();
  // The next payment settles the renewal.
  await expect(page.getByRole('button', { name: 'Log Insurance renewal' })).toBeHidden();

  await page.goto('/reports');
  const total = page.locator('.report-total', { hasText: 'Total spent' });
  const average = page.locator('.report-total', { hasText: 'Average per visit' });
  // Service 200, fuel 35 + 35 + 60, and costs 50 + 10.
  await expect(total.locator('strong')).toHaveText(/^USD\s390\.00$/);
  await expect(total).toContainText('7 records in this view');
  await expect(average.locator('strong')).toHaveText(/^USD\s100\.00$/);

  await page.getByLabel('Report car').selectOption({ label: 'Daily Civic' });
  await expect(total.locator('strong')).toHaveText(/^USD\s250\.00$/);
  await expect(total).toContainText('5 records in this view');
  // 250 over the 300 miles between the Civic's lowest and highest readings.
  await expect(
    page.locator('.report-total', { hasText: 'Cost per mile' }).locator('strong'),
  ).toHaveText(/^USD\s0\.83$/);
});

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

  await page.goto('/reports');
  const total = page.locator('.report-total', { hasText: 'Total spent' });
  const average = page.locator('.report-total', { hasText: 'Average per visit' });
  await expect(total.locator('strong')).toHaveText(/^USD\s200\.00$/);
  await expect(total).toContainText('2 service visits in this view');
  await expect(average.locator('strong')).toHaveText(/^USD\s100\.00$/);

  await page.getByLabel('Report car').selectOption({ label: 'Daily Civic' });
  await expect(total.locator('strong')).toHaveText(/^USD\s120\.00$/);
  await expect(total).toContainText('1 service visit in this view');
});

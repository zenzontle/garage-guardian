import { expect, test } from '@playwright/test';
import { addCar, addTask, logService, openGarage, statCard } from './support/garage';

test('reminds about an interval task and moves it forward after service', async ({ page }) => {
  await openGarage(page);
  const carId = await addCar(page, {
    name: 'Daily Civic',
    year: 2019,
    make: 'Honda',
    model: 'Civic',
    odometer: 4800,
  });

  // With no first due point, a 5,000-mile interval is first due at the next 5,000-mile mark.
  await addTask(page, { name: 'Brake fluid', intervalMiles: 5000 });
  const task = page.locator('.schedule-row').filter({ hasText: 'Brake fluid' });
  await expect(task).toContainText('at 5,000 mi');
  await expect(task).toContainText('Coming up');

  await page.goto('/');
  await expect(statCard(page, 'Coming up').locator('strong')).toHaveText('1');
  await expect(page.getByText('Brake fluid')).toBeVisible();

  await page.goto(`/cars/${carId}`);
  await logService(page, { items: [{ task: 'Brake fluid' }], total: 95, odometer: 5100 });
  await expect(task).toContainText('at 10,100 mi');
  await expect(task).not.toContainText('Coming up');

  await page.goto('/');
  await expect(statCard(page, 'Coming up').locator('strong')).toHaveText('0');
});

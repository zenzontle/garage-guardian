import { expect, test } from '@playwright/test';
import { addCar, openGarage, statCard, toast } from './support/garage';

test('adds, edits, archives and restores vehicles that persist after reload', async ({ page }) => {
  await openGarage(page);
  await expect(
    page.getByRole('heading', { name: 'Every car has a story. Start yours here.' }),
  ).toBeVisible();

  const civicId = await addCar(page, {
    name: 'Daily Civic',
    year: 2019,
    make: 'Honda',
    model: 'Civic',
    odometer: 42000,
    plate: 'AbC-123',
  });
  await expect(page.getByText('Plate: AbC-123')).toBeVisible();
  await expect(page.getByText('42,000 mi current odometer')).toBeVisible();

  await addCar(page, {
    name: 'Road Trip Van',
    year: 2022,
    make: 'Toyota',
    model: 'Sienna',
    odometer: 80000,
    unit: 'kilometers',
  });
  await expect(page.getByText('80,000 km current odometer')).toBeVisible();

  const switcher = page.getByRole('navigation', { name: 'Choose vehicle' });
  await expect(switcher.getByRole('link')).toHaveText(['Daily Civic', 'Road Trip Van']);
  await page.goto('/');
  await expect(statCard(page, 'Vehicles').locator('strong')).toHaveText('2');

  await page.goto(`/cars/${civicId}`);
  await page.getByRole('button', { name: 'Edit car' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit car' });
  await edit.getByLabel('Nickname').fill('Weekend Civic');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  await expect(toast(page, 'Vehicle saved.')).toBeVisible();
  await expect(page).toHaveURL(`/cars/${civicId}`);
  await expect(page.getByRole('heading', { name: 'Weekend Civic', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit car' }).click();
  await edit.getByRole('button', { name: 'Archive vehicle' }).click();
  await expect(edit.getByRole('alert')).toContainText('Archive this vehicle?');
  await edit.getByRole('button', { name: 'Archive vehicle' }).click();
  await expect(edit).toBeHidden();
  await expect(toast(page, 'Vehicle archived. Reminders are paused.')).toBeVisible();
  await expect(page.getByText('Reminders are paused. Service records')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Archived', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.getByRole('button', { name: 'Restore vehicle' }).click();
  await expect(toast(page, 'Vehicle restored. Reminders have resumed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore vehicle' })).toBeHidden();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Weekend Civic', exact: true })).toBeVisible();
  await expect(page.getByText('Plate: AbC-123')).toBeVisible();
  await expect(switcher.getByRole('link')).toHaveCount(2);
  await expect(switcher.getByRole('link', { name: 'Road Trip Van' })).toBeVisible();
  await page.goto('/');
  await expect(statCard(page, 'Vehicles').locator('strong')).toHaveText('2');
});

test('explains when a vehicle link is not in this garage', async ({ page }) => {
  await openGarage(page, `/cars/${crypto.randomUUID()}`);
  await expect(page.getByRole('heading', { name: 'Vehicle unavailable' })).toBeVisible();
  await expect(page.getByText('This vehicle is not in your current garage.')).toBeVisible();
});

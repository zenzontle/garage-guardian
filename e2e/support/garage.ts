import { expect, type Locator, type Page } from '@playwright/test';
import path from 'node:path';

// Helpers drive the app through its English labels in messages/en.json.

export const receiptPhoto = path.join(__dirname, '..', 'fixtures', 'receipt.jpg');

export type Screen = 'dashboard' | 'cars' | 'fuel' | 'history' | 'reports';
const screenPaths: Record<Screen, string> = {
  dashboard: '/',
  cars: '/cars',
  fuel: '/fuel',
  history: '/history',
  reports: '/reports',
};

export async function openGarage(page: Page, url = '/') {
  await page.goto(url);
  // The notice only renders without Supabase credentials, so it also confirms prototype mode.
  // Opening the garage reads IndexedDB first, which can be slow on a busy machine.
  await expect(page.getByText('Local prototype: your data stays in this browser.')).toBeVisible({
    timeout: 15_000,
  });
}

export function toast(page: Page, message: string) {
  return page.getByRole('status').filter({ hasText: message });
}

// Desktop shows the sidebar and phones show the bottom tabs; only one of them is visible.
// It is found by its links rather than its name, which changes with the language.
export function workspaceNavigation(page: Page) {
  return page.getByRole('navigation').filter({ has: page.locator('a[href="/reports"]') });
}

export async function goTo(page: Page, screen: Screen) {
  await workspaceNavigation(page).locator(`a[href="${screenPaths[screen]}"]`).click();
}

export function statCard(page: Page, label: string) {
  return page.locator('.stat-card', { has: page.getByText(label, { exact: true }) });
}

export async function addCar(
  page: Page,
  car: {
    name: string;
    year: number;
    make: string;
    model: string;
    odometer: number;
    plate?: string;
    unit?: 'miles' | 'kilometers';
  },
): Promise<string> {
  await page.getByRole('button', { name: 'Add a car', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add a car' });
  await dialog.getByLabel('Nickname').fill(car.name);
  await dialog.getByLabel('Year', { exact: true }).fill(String(car.year));
  await dialog.getByLabel('Make', { exact: true }).fill(car.make);
  await dialog.getByLabel('Model', { exact: true }).fill(car.model);
  await dialog.getByLabel('Distance unit').selectOption(car.unit ?? 'miles');
  await dialog.getByLabel(/^Current odometer/).fill(String(car.odometer));
  if (car.plate) await dialog.getByLabel('License plate').fill(car.plate);
  await dialog.getByRole('button', { name: 'Add car', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(toast(page, 'Vehicle saved.')).toBeVisible();
  await expect(page.getByRole('heading', { name: car.name, exact: true })).toBeVisible();
  const id = /\/cars\/([^/?#]+)$/.exec(new URL(page.url()).pathname)?.[1];
  if (!id) throw new Error(`Expected a vehicle page after saving, got ${page.url()}`);
  return decodeURIComponent(id);
}

// Run from a vehicle page.
export async function addTask(
  page: Page,
  task: { name: string; intervalMiles?: number; intervalMonths?: number },
) {
  await page.getByRole('button', { name: 'Add task' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add maintenance task' });
  await dialog.getByLabel('Task name').fill(task.name);
  if (task.intervalMiles !== undefined)
    await dialog.getByLabel(/^Repeat every (miles|kilometers)/).fill(String(task.intervalMiles));
  if (task.intervalMonths !== undefined)
    await dialog.getByLabel(/^Repeat every months/).fill(String(task.intervalMonths));
  await dialog.getByRole('button', { name: 'Save task' }).click();
  await expect(dialog).toBeHidden();
  await expect(toast(page, 'Maintenance task saved.')).toBeVisible();
}

export type ServiceItem = { task?: string; name?: string; cost?: number };

// Run from a page with a Log service button; a vehicle page preselects that vehicle.
export async function logService(
  page: Page,
  visit: {
    items: ServiceItem[];
    total: number;
    odometer?: number;
    provider?: string;
    photo?: string;
  },
) {
  await page.getByRole('button', { name: 'Log service' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Log service' });
  if (visit.odometer !== undefined)
    await dialog.getByLabel(/^Odometer \(/).fill(String(visit.odometer));
  await dialog.getByLabel(/^Total cost/).fill(visit.total.toFixed(2));
  if (visit.provider) await dialog.getByLabel(/^Provider/).fill(visit.provider);
  for (const [index, item] of visit.items.entries()) {
    if (index > 0) await dialog.getByRole('button', { name: 'Add item' }).click();
    if (item.task)
      await dialog
        .getByLabel('Choose scheduled task')
        .nth(index)
        .selectOption({ label: item.task });
    if (item.name) await dialog.getByLabel('Service item name').nth(index).fill(item.name);
    if (item.cost !== undefined)
      await dialog
        .getByLabel(/^Item cost/)
        .nth(index)
        .fill(item.cost.toFixed(2));
  }
  if (visit.photo) await attachPhoto(page, dialog, visit.photo);
  await dialog.getByRole('button', { name: 'Save visit' }).click();
  await expect(dialog).toBeHidden();
  await expect(toast(page, 'Service visit saved.')).toBeVisible();
}

async function attachPhoto(page: Page, dialog: Locator, file: string) {
  await dialog.getByLabel(/^Photos/).setInputFiles(file);
  // Chromium resizes photos to WebP in the browser before they are attached.
  const name = `${path.basename(file, path.extname(file))}.webp`;
  await expect(dialog.getByRole('button', { name: `Remove ${name}` })).toBeVisible();
  await expect(page.getByText('Preparing photos…')).toBeHidden();
}

// Run from a page with a Log fuel button; a vehicle page preselects that vehicle.
export async function addFillUp(
  page: Page,
  fillUp: { odometer: number; volume: number; price: number },
) {
  await page.getByRole('button', { name: 'Log fuel' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Log fuel' });
  await dialog.getByLabel(/^Odometer \(/).fill(String(fillUp.odometer));
  await dialog.getByLabel('Volume', { exact: true }).fill(String(fillUp.volume));
  await dialog.getByLabel(/^Price per/).fill(String(fillUp.price));
  await dialog.getByRole('button', { name: 'Save fill-up' }).click();
  await expect(dialog).toBeHidden();
  await expect(toast(page, 'Fill-up saved.')).toBeVisible();
}

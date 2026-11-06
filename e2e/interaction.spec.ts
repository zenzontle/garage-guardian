import { expect, test } from '@playwright/test';
import { goTo, openGarage, workspaceNavigation } from './support/garage';

test('asks before discarding an unsaved vehicle draft', async ({ page }) => {
  await openGarage(page);
  await goTo(page, 'cars');
  await expect(page).toHaveURL('/cars');
  await page.getByRole('button', { name: 'Add a car', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add a car' });
  await dialog.getByLabel('Nickname').fill('Draft car');

  const prompt = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await prompt.getByRole('button', { name: 'Keep editing' }).click();
  await expect(prompt).toBeHidden();
  await expect(dialog.getByLabel('Nickname')).toHaveValue('Draft car');

  // Browser Back stays on the page until the draft is discarded.
  await page.goBack();
  await expect(prompt).toBeVisible();
  await expect(page).toHaveURL('/cars');
  await prompt.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog.getByLabel('Nickname')).toHaveValue('Draft car');

  await page.goBack();
  await prompt.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL('/');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Your garage at a glance' })).toBeVisible();
});

test('switches the language and keeps it after reload', async ({ page }) => {
  await openGarage(page);
  const dashboardLink = workspaceNavigation(page).locator('a[href="/"]');
  await expect(dashboardLink).toHaveText('Dashboard');

  await page.getByLabel('Language').selectOption('es');
  await expect(dashboardLink).toHaveText('Resumen');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  await page.reload();
  await expect(dashboardLink).toHaveText('Resumen');
  await expect(page.getByLabel('Idioma')).toHaveValue('es');

  await page.getByLabel('Idioma').selectOption('en');
  await expect(dashboardLink).toHaveText('Dashboard');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

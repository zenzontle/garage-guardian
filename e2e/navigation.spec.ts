import { expect, test } from '@playwright/test';
import { addCar, goTo, logService, openGarage } from './support/garage';

const civic = { name: 'Daily Civic', year: 2019, make: 'Honda', model: 'Civic', odometer: 42000 };

test.describe('mobile menu', () => {
  test.skip(({ isMobile }) => !isMobile, 'The menu drawer only exists at phone widths.');

  test('moves focus into the drawer and back to the menu button', async ({ page }) => {
    await openGarage(page);
    const menuButton = page.getByRole('button', { name: 'Open menu' });
    const drawer = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(drawer).toBeHidden();

    await menuButton.click();
    await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(drawer.getByRole('link', { name: 'Dashboard' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menuButton).toBeFocused();

    for (const [name, url, heading] of [
      ['My cars', '/cars', 'My cars'],
      ['Fuel log', '/fuel', 'Fuel log'],
      ['Service history', '/history', 'Service history'],
      ['Reports', '/reports', 'Reports'],
      ['Dashboard', '/', 'Your garage at a glance'],
    ]) {
      await menuButton.click();
      await drawer.getByRole('link', { name }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(drawer).toBeHidden();
      await expect(
        page.getByRole('navigation', { name: 'Mobile navigation' }).locator(`a[href="${url}"]`),
      ).toHaveAttribute('aria-current', 'page');
    }
  });
});

test.describe('desktop navigation', () => {
  test.skip(({ isMobile }) => isMobile, 'Covers desktop history and layout.');

  test('follows Back and Forward across screens and reloads a vehicle link', async ({ page }) => {
    await openGarage(page);
    const carId = await addCar(page, civic);
    const heading = page.getByRole('heading', { level: 1 });

    await goTo(page, 'dashboard');
    await expect(heading).toHaveText('Your garage at a glance');
    await goTo(page, 'cars');
    // My cars opens the first vehicle.
    await expect(page).toHaveURL(`/cars/${carId}`);
    await goTo(page, 'fuel');
    await expect(heading).toHaveText('Fuel log');
    await goTo(page, 'history');
    await expect(heading).toHaveText('Service history');
    await goTo(page, 'reports');
    await expect(heading).toHaveText('Reports');

    await page.goBack();
    await expect(page).toHaveURL('/history');
    await expect(heading).toHaveText('Service history');
    await page.goBack();
    await expect(page).toHaveURL('/fuel');
    await expect(heading).toHaveText('Fuel log');
    await page.goForward();
    await expect(page).toHaveURL('/history');
    await expect(heading).toHaveText('Service history');

    await page.goto(`/cars/${carId}`);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Daily Civic', exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'My cars' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('stacks service history into cards at 720px and below', async ({ page }) => {
    await openGarage(page);
    await addCar(page, civic);
    await logService(page, { items: [{ name: 'Inspection' }], total: 40 });
    await page.goto('/history');
    const table = page.getByRole('table');
    const cards = page.getByRole('list', { name: 'Service history' });

    await expect(table).toBeVisible();
    await expect(cards).toBeHidden();

    await page.setViewportSize({ width: 720, height: 900 });
    await expect(table).toBeHidden();
    await expect(cards).toBeVisible();
    await expect(cards.getByRole('listitem')).toHaveCount(1);

    await page.setViewportSize({ width: 721, height: 900 });
    await expect(table).toBeVisible();
    await expect(cards).toBeHidden();
  });
});

import { defineConfig, devices } from '@playwright/test';

// Browser tests run the production build in local prototype mode: with no Supabase variables,
// the app stores everything in IndexedDB, so each test's fresh browser context starts empty.
const port = 3210;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, locale: 'en-US', timezoneId: 'UTC', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `pnpm start -p ${port} -H 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});

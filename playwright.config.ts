import { defineConfig, devices } from '@playwright/test';

// Browser tests run the production build in local prototype mode: with no Supabase variables,
// the app stores everything in IndexedDB, so each test's fresh browser context starts empty.
const port = 3210;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a flaky spec should fail CI, not pass on a second try.
  retries: 0,
  // Fail with a report well before the CI job's own timeout cancels the run.
  globalTimeout: 10 * 60_000,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, locale: 'en-US', timezoneId: 'UTC', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Call Next's binary directly: on Linux, Playwright cannot stop a server started through
    // pnpm, so the run hangs after the last test until the CI job times out.
    command: `node node_modules/next/dist/bin/next start -p ${port} -H 127.0.0.1`,
    url: baseURL,
    // Never reuse a running server: it could be serving a stale build.
    reuseExistingServer: false,
  },
});

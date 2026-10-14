import { defineConfig, devices } from '@playwright/test';

/**
 * WP-004R browser acceptance scaffold.
 * Run: bunx playwright test -c e2e/playwright.config.ts
 * Requires web dev server + API + Postgres (see docs/e2e/WP-004R-browser.md).
 */
export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_SKIP_WEB_SERVER
    ? undefined
    : {
        command: 'bun run e2e:stack',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});

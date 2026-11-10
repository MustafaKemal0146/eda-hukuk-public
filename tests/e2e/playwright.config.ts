import { defineConfig, devices } from '@playwright/test';

const hostResolverRules = process.env.E2E_HOST_RESOLVER_RULES;
const launchArgs: string[] = ['--no-sandbox', '--disable-setuid-sandbox'];
if (hostResolverRules) {
  launchArgs.push(`--host-resolver-rules=${hostResolverRules}`);
}

export default defineConfig({
  testDir: './specs',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_APP_URL || 'https://app.eda.localhost',
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === '1',
    trace: 'on-first-retry',
    launchOptions: {
      args: launchArgs,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

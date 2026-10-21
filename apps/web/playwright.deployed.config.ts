import { defineConfig, devices } from '@playwright/test';

// Smoke test of a deployed site (NSTOCK-0281, docs/runbooks/release.md): a Firebase preview
// channel, the release candidate or the live site, at E2E_BASE_URL. No local server and no test
// controls: it checks what reviewers get. Run with `npm run e2e:deployed -w @nthstock/web`.
const baseURL = process.env['E2E_BASE_URL'];
if (!baseURL)
  throw new Error('Set E2E_BASE_URL to the deployed site, e.g. https://<project>.web.app');
const executablePath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: './e2e/deployed',
  testMatch: '**/*.deployed.ts',
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'] } }],
});

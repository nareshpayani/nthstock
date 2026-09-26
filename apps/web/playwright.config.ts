import { defineConfig, devices } from '@playwright/test';

// Smoke tests (T-030, T-078). Chrome only (D4). Runs against a production build in msw mode with
// the mock market forced open, so live prices tick at any hour; the variables are set here, so CI
// needs no extra env.
// PW_CHROMIUM_PATH points at a preinstalled Chromium in sandboxes; CI installs its own.
const executablePath = process.env.PW_CHROMIUM_PATH;
const port = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${String(port)} --strictPort`,
    url: `http://127.0.0.1:${String(port)}`,
    env: { VITE_API_MODE: 'msw', VITE_MOCK_MARKET_OPEN: 'true' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

import { defineConfig, devices } from '@playwright/test';

// Before/after screenshots for UI pull requests (NSTOCK-0285, docs/runbooks/pr-screenshots.md).
// No web server here: .github/workflows/pr-screenshots.yml serves the base build at BEFORE_URL and
// the PR's build at AFTER_URL (msw mode, VITE_MOCK_MARKET_OPEN off so prices hold still). Locally:
//   AFTER_URL=http://127.0.0.1:4173 npx playwright test -c e2e/screens/playwright.screens.config.ts
// (with BEFORE_URL too for a comparison). Output goes to SCREENS_OUT_DIR (default screens-out).
const executablePath = process.env['PW_CHROMIUM_PATH'];
if (!process.env['AFTER_URL']) throw new Error('Set AFTER_URL to the build to capture');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.screens.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'] } }],
});

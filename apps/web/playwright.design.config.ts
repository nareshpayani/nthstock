import { defineConfig, devices } from '@playwright/test';

// The design captures for DESIGN.md (SPEC-CR-1 §11, CR-T01, CR-T23, CR-T24): screenshots of the
// mobile Trade from Charts flow at every viewport of the matrix (e2e/support/viewportMatrix.ts),
// and a phone recording of the flow. Runs against DESIGN_BASE_URL, a local `vite preview` of an
// msw-mode build with the mock market open:
//
//   VITE_API_MODE=msw VITE_MOCK_MARKET_OPEN=true npx vite build --outDir dist-design
//   npx vite preview --outDir dist-design --port 4190 &
//   DESIGN_OUT=../../docs/design/before npx playwright test -c playwright.design.config.ts
//
// Not part of CI: it records, it does not gate.
const baseURL = process.env['DESIGN_BASE_URL'] ?? 'http://127.0.0.1:4190';
const executablePath = process.env['PW_CHROMIUM_PATH'];
const launch = executablePath ? { launchOptions: { executablePath } } : {};
const PHONE = { width: 390, height: 844 };

export default defineConfig({
  testDir: './e2e/design',
  outputDir: './test-results/design/runs',
  reporter: 'list',
  expect: { timeout: 20_000 },
  workers: 2,
  use: { baseURL, ...launch },
  projects: [
    {
      name: 'captures',
      testMatch: 'captureFlow.design.ts',
      use: { ...devices['Desktop Chrome'], ...launch },
    },
    {
      name: 'recording',
      testMatch: 'recordFlow.design.ts',
      use: {
        ...devices['Pixel 7'],
        viewport: PHONE,
        screen: PHONE,
        video: { mode: 'on', size: PHONE },
        ...launch,
      },
    },
  ],
});

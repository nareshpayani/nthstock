import { defineConfig, devices } from '@playwright/test';

// The T30 demo walkthrough video (SPEC-TFC-1 §16, docs/runbooks/demo-walkthrough.md): one spec,
// recorded on a 390 × 844 touch phone, against WALKTHROUGH_BASE_URL (the live site, or a local
// `vite preview` of the production build). tools/demo/recordWalkthrough.sh runs it and encodes the
// video. Not part of CI: it records, it does not gate.
const baseURL = process.env['WALKTHROUGH_BASE_URL'] ?? 'http://127.0.0.1:4180';
const executablePath = process.env['PW_CHROMIUM_PATH'];
const PHONE = { width: 390, height: 844 };

export default defineConfig({
  testDir: './e2e/walkthrough',
  testMatch: '**/*.walkthrough.ts',
  outputDir: './test-results/walkthrough',
  reporter: 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL,
    viewport: PHONE,
    screen: PHONE,
    video: { mode: 'on', size: PHONE },
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
});

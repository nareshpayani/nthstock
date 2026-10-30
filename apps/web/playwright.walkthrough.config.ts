import { defineConfig, devices } from '@playwright/test';

// The walkthrough videos (docs/runbooks/demo-walkthrough.md): the T30 demo walkthrough on a
// 390 × 844 touch phone (SPEC-TFC-1 §16), and one clip per feature (NSTOCK-0390) on a 1440 × 900
// desktop and a phone, against WALKTHROUGH_BASE_URL (a local `vite preview` of the production
// build, or the live site for the T30 take). tools/demo/recordWalkthrough.sh runs it and encodes
// each clip. Not part of CI: it records, it does not gate.
const baseURL = process.env['WALKTHROUGH_BASE_URL'] ?? 'http://127.0.0.1:4180';
const executablePath = process.env['PW_CHROMIUM_PATH'];
const launch = executablePath ? { launchOptions: { executablePath } } : {};
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const IPHONE = { width: 440, height: 956 };

export default defineConfig({
  testDir: './e2e/walkthrough',
  outputDir: './test-results/walkthrough/runs',
  reporter: 'list',
  // A cold load of the production build waits on the MSW worker; give it room on a busy machine.
  expect: { timeout: 20_000 },
  // One clip at a time: a busy CPU slows the page down and the clips drag on screen.
  workers: 1,
  use: { baseURL },
  projects: [
    {
      name: 'phone',
      testMatch: ['demoWalkthrough.walkthrough.ts', 'phone/*.walkthrough.ts'],
      testIgnore: 'phone/craftRecording.walkthrough.ts',
      use: {
        ...devices['Pixel 7'],
        viewport: PHONE,
        screen: PHONE,
        video: { mode: 'on', size: PHONE },
        ...launch,
      },
    },
    {
      // The round 2 phone recording (docs/design/recordingScript.md): an iPhone 16 Pro Max screen
      // in Chrome's device mode, the whole screen as the page, recorded at 3× by the clip itself.
      name: 'iphone',
      testMatch: 'phone/craftRecording.walkthrough.ts',
      use: {
        ...devices['iPhone 16 Pro Max'],
        defaultBrowserType: 'chromium',
        viewport: IPHONE,
        screen: IPHONE,
        video: { mode: 'on', size: IPHONE },
        // Without it, Chrome's screencast sends CSS-pixel frames whatever the emulated density.
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          args: ['--force-device-scale-factor=3'],
        },
      },
    },
    {
      name: 'desktop',
      testMatch: 'desktop/*.walkthrough.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: DESKTOP,
        screen: DESKTOP,
        deviceScaleFactor: 1,
        video: { mode: 'on', size: DESKTOP },
        ...launch,
      },
    },
  ],
});

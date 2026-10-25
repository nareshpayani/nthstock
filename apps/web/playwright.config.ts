import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import {
  API_ORIGIN,
  API_TAG,
  DEV_TAG,
  E2E_DEV,
  E2E_MODE,
  E2E_PERF,
  E2E_PORTS,
  E2E_WEBKIT,
  PERF_TAG,
  REALTIME_ORIGIN,
  JOURNEY_TAG,
  TOUCH_TAG,
} from './e2e/support/env';

// E2E suites (T-030, T-078, T-163 to T-167). Chrome only (D4), plus iPhone Safari for the Trade
// from Charts surfaces (TFC-16).
//
// msw mode (default, `npm run e2e`): a production build with MSW in the browser, the mock market
// forced open (live prices tick at any hour) and the MSW test controls (VITE_TEST_CONTROLS, T-162)
// in its own dist-e2e folder, so `dist` never carries them. Every spec runs.
//
// api mode (`E2E_MODE=api`, T-164): apps/api and apps/realtime from their dist builds with
// NODE_ENV=test and ENABLE_TEST_CONTROLS=true, over Redis at E2E_REDIS_URL (default
// redis://127.0.0.1:6379, the CI service) and Postgres at E2E_DATABASE_URL (default the migrated
// `npm run infra:up` database as nthstock_app, like the CI service; T-182), plus an api-mode web
// build behind the preview proxy. apps/api counts as started once /v1/health/ready answers 200.
// Only specs tagged @api run, one at a time, since they share one backend clock.
//
// perf (`E2E_PERF=1`, T-169 and T-170): the msw-mode build, only the specs tagged @perf (Web Vitals
// and render budgets), one at a time so nothing competes for the CPU. The other modes skip them.
//
// Touch projects (T04, SPEC-TFC-1 §13): specs tagged @touch run on `chromium-mobile` (390 × 844,
// touch, Chromium) and, with E2E_WEBKIT=1 once WebKit is installed, on `webkit-iphone` (an iPhone 13
// in WebKit). They drive gestures through `e2e/support/touch.ts`. The desktop project skips them.
//
// The variables are set here, so CI needs no extra env. PW_CHROMIUM_PATH points at a preinstalled
// Chromium in sandboxes; CI installs its own.
const executablePath = process.env['PW_CHROMIUM_PATH'];
const web = `http://127.0.0.1:${String(E2E_PORTS.web)}`;
const api = E2E_MODE === 'api';

const preview = (outDir: string) =>
  `npx vite build --outDir ${outDir} --emptyOutDir && npx vite preview --outDir ${outDir} --host 127.0.0.1 --port ${String(E2E_PORTS.web)} --strictPort`;

/** One key for both backends, made per run: never a committed secret. */
const jwtSecret = randomBytes(32).toString('base64url');
const redisUrl = process.env['E2E_REDIS_URL'] || 'redis://127.0.0.1:6379';
const databaseUrl =
  process.env['E2E_DATABASE_URL'] ||
  'postgres://nthstock_app:nthstock_app_dev@127.0.0.1:5432/nthstock';
const backendEnv = {
  NODE_ENV: 'test',
  ENABLE_TEST_CONTROLS: 'true',
  HOST: '127.0.0.1',
  JWT_SECRET: jwtSecret,
  REDIS_URL: redisUrl,
  DB_DRIVER: 'postgres',
  DATABASE_URL: databaseUrl,
};

// E2E_DEV (NSTOCK-0361): the dev server itself, as `npm run dev` runs it, on the E2E port.
const devServer = {
  command: `npx vite --host 127.0.0.1 --port ${String(E2E_PORTS.web)} --strictPort`,
  url: web,
  env: { VITE_API_MODE: 'msw', VITE_MOCK_MARKET_OPEN: 'true', VITE_TEST_CONTROLS: 'true' },
  reuseExistingServer: false,
  timeout: 180_000,
};

const mswServer = {
  command: preview('dist-e2e'),
  url: web,
  env: { VITE_API_MODE: 'msw', VITE_MOCK_MARKET_OPEN: 'true', VITE_TEST_CONTROLS: 'true' },
  reuseExistingServer: !process.env['CI'],
  timeout: 180_000,
};

const apiServers = [
  {
    command: 'node ../api/dist/server.js',
    url: `${API_ORIGIN}/v1/health/ready`,
    env: { ...backendEnv, PORT: String(E2E_PORTS.api) },
    reuseExistingServer: false,
    timeout: 60_000,
  },
  {
    command: 'node ../realtime/dist/server.js',
    url: `${REALTIME_ORIGIN}/health`,
    env: { ...backendEnv, PORT: String(E2E_PORTS.realtime) },
    reuseExistingServer: false,
    timeout: 60_000,
  },
  {
    command: preview('dist-e2e-api'),
    url: web,
    env: {
      VITE_API_MODE: 'api',
      API_PROXY_TARGET: API_ORIGIN,
      REALTIME_PROXY_TARGET: `ws://127.0.0.1:${String(E2E_PORTS.realtime)}`,
    },
    reuseExistingServer: false,
    timeout: 180_000,
  },
];

// The touch projects run the touch specs and the journeys (T26); the desktop project runs the
// journeys too, since it skips only @touch and @perf.
const TOUCH_PROJECT_GREP = new RegExp(`${TOUCH_TAG}|${JOURNEY_TAG}`);
const launch = executablePath ? { launchOptions: { executablePath } } : {};
const touchProjects = [
  {
    name: 'chromium-mobile',
    grep: TOUCH_PROJECT_GREP,
    use: {
      ...devices['Pixel 7'],
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      ...launch,
    },
  },
  ...(E2E_WEBKIT
    ? [{ name: 'webkit-iphone', grep: TOUCH_PROJECT_GREP, use: { ...devices['iPhone 13'] } }]
    : []),
];

export default defineConfig({
  testDir: './e2e',
  // Other specs import package dist at load time; the dev run deletes some of it on purpose.
  ...(E2E_DEV ? { testMatch: /consoleClean\.spec\.ts$/ } : {}),
  fullyParallel: !api && !E2E_PERF,
  ...(api || E2E_PERF ? { workers: 1 } : {}),
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: web, trace: 'retain-on-failure' },
  projects: E2E_DEV
    ? [
        {
          name: 'chrome-dev',
          grep: new RegExp(DEV_TAG),
          use: { ...devices['Desktop Chrome'], ...launch },
        },
      ]
    : api
      ? [
          {
            name: 'chrome-api',
            grep: new RegExp(API_TAG),
            use: { ...devices['Desktop Chrome'], ...launch },
          },
        ]
      : E2E_PERF
        ? [
            {
              name: 'chrome',
              grep: new RegExp(PERF_TAG),
              use: { ...devices['Desktop Chrome'], ...launch },
            },
          ]
        : [
            {
              name: 'chrome',
              grepInvert: new RegExp(`${PERF_TAG}|${TOUCH_TAG}`),
              use: { ...devices['Desktop Chrome'], ...launch },
            },
            ...touchProjects,
          ],
  webServer: E2E_DEV ? devServer : api ? apiServers : mswServer,
});

import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { API_ORIGIN, API_TAG, E2E_MODE, E2E_PORTS, REALTIME_ORIGIN } from './e2e/support/env';

// E2E suites (T-030, T-078, T-163 to T-167). Chrome only (D4).
//
// msw mode (default, `npm run e2e`): a production build with MSW in the browser, the mock market
// forced open (live prices tick at any hour) and the MSW test controls (VITE_TEST_CONTROLS, T-162)
// in its own dist-e2e folder, so `dist` never carries them. Every spec runs.
//
// api mode (`E2E_MODE=api`, T-164): apps/api and apps/realtime from their dist builds with
// NODE_ENV=test and ENABLE_TEST_CONTROLS=true, over Redis at E2E_REDIS_URL (default
// redis://127.0.0.1:6379, the CI service), plus an api-mode web build behind the preview proxy.
// Only specs tagged @api run, one at a time, since they share one backend clock.
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
const backendEnv = {
  NODE_ENV: 'test',
  ENABLE_TEST_CONTROLS: 'true',
  HOST: '127.0.0.1',
  JWT_SECRET: jwtSecret,
  REDIS_URL: redisUrl,
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
    url: `${API_ORIGIN}/v1/health`,
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

export default defineConfig({
  testDir: './e2e',
  fullyParallel: !api,
  ...(api ? { workers: 1, grep: new RegExp(API_TAG) } : {}),
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: web,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: api ? 'chrome-api' : 'chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: api ? apiServers : mswServer,
});

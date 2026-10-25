// Where the E2E suites run (T-163, T-164). `E2E_MODE=msw` (default) builds the web app with MSW in
// the browser; `E2E_MODE=api` starts apps/api and apps/realtime (with their test controls) next to
// an api-mode build, and runs only the specs tagged @api. Read by playwright.config.ts and specs.

export type E2eMode = 'msw' | 'api';

export const E2E_MODE: E2eMode = process.env['E2E_MODE'] === 'api' ? 'api' : 'msw';

/**
 * Ports clear of `npm run dev` / `npm run dev:api` (5173, 4000, 8081), so both can run at once.
 * `apiSupervisor` is the api-mode control port that restarts apps/api (T-241).
 */
export const E2E_PORTS = { web: 4173, api: 4100, apiSupervisor: 4101, realtime: 8181 } as const;

export const API_ORIGIN = `http://127.0.0.1:${String(E2E_PORTS.api)}`;
export const API_SUPERVISOR_ORIGIN = `http://127.0.0.1:${String(E2E_PORTS.apiSupervisor)}`;
export const REALTIME_ORIGIN = `http://127.0.0.1:${String(E2E_PORTS.realtime)}`;

/**
 * `E2E_DEV=1` (`npm run e2e:dev`, NSTOCK-0361): runs the specs tagged @dev against the Vite dev
 * server, the way `npm run dev` serves the app on a laptop, instead of a production build. CI runs
 * it with the packages' `dist` deleted, so a dev server that leans on stale builds fails.
 */
export const E2E_DEV = process.env['E2E_DEV'] === '1';

/** Tag for specs that also run on the dev server (`E2E_DEV=1`). */
export const DEV_TAG = '@dev';

/** Tag for specs that also run in api mode against the real backends. */
export const API_TAG = '@api';

/**
 * Tag for the performance-budget specs (T-169, T-170). They run only with `E2E_PERF=1`
 * (`npm run e2e:perf`), on one worker, so nothing else competes for the CPU while they measure.
 */
export const PERF_TAG = '@perf';

export const E2E_PERF = process.env['E2E_PERF'] === '1';

/**
 * Tag for the touch specs (T04): they run on the `chromium-mobile` project and, with
 * `E2E_WEBKIT=1`, on `webkit-iphone`. The desktop project skips them.
 */
export const TOUCH_TAG = '@touch';

/** WebKit must be installed (`npx playwright install webkit`) before the iPhone project runs. */
export const E2E_WEBKIT = process.env['E2E_WEBKIT'] === '1';

/**
 * Tag for the journey specs (T26, SPEC-TFC-1 US-01 to US-05): they run on every project, the
 * desktop one and both touch ones.
 */
export const JOURNEY_TAG = '@journey';

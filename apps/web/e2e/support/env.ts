// Where the E2E suites run (T-163, T-164). `E2E_MODE=msw` (default) builds the web app with MSW in
// the browser; `E2E_MODE=api` starts apps/api and apps/realtime (with their test controls) next to
// an api-mode build, and runs only the specs tagged @api. Read by playwright.config.ts and specs.

export type E2eMode = 'msw' | 'api';

export const E2E_MODE: E2eMode = process.env['E2E_MODE'] === 'api' ? 'api' : 'msw';

/** Ports clear of `npm run dev` / `npm run dev:api` (5173, 4000, 8081), so both can run at once. */
export const E2E_PORTS = { web: 4173, api: 4100, realtime: 8181 } as const;

export const API_ORIGIN = `http://127.0.0.1:${String(E2E_PORTS.api)}`;
export const REALTIME_ORIGIN = `http://127.0.0.1:${String(E2E_PORTS.realtime)}`;

/** Tag for specs that also run in api mode against the real backends. */
export const API_TAG = '@api';

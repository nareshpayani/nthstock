import {
  AUTH_CSRF_HEADER,
  TEST_CONTROL_PATHS,
  TICK_SIZE_PAISE,
  type TestClockRequest,
  type TestPriceRequest,
} from '@nthstock/contracts';
import { expect, type Page } from '@playwright/test';
import { API_ORIGIN, E2E_MODE, REALTIME_ORIGIN } from './env';

// Test-only controls (T-162) from a spec, the same calls in both modes:
// - msw: the MSW /v1/__test handlers in the page (the Playwright build sets VITE_TEST_CONTROLS);
// - api: apps/api's /v1/__test routes and apps/realtime's clock (ENABLE_TEST_CONTROLS, NODE_ENV=test).
// The page clock always moves too, so the UI (market status, AMO dates) agrees with the backend.

/** Monday 28 Sep 2026, 10:00 IST: a trading day, market open. */
export const MONDAY_10_00_IST = '2026-09-28T04:30:00.000Z';
/** The same Monday, 15:35 IST: after the close, so delivery buys have moved to holdings. */
export const MONDAY_15_35_IST = '2026-09-28T10:05:00.000Z';
/** The same Monday, 20:00 IST: closed, so orders wait as AMO. */
export const MONDAY_20_00_IST = '2026-09-28T14:30:00.000Z';
/** Tuesday 29 Sep 2026, 9:15:30 IST: just after the 9:15 AMO release. */
export const TUESDAY_09_15_IST = '2026-09-29T03:45:30.000Z';

/** Any non-empty CSRF value passes before a session (AUTH_CSRF_HEADER). */
const CSRF = { [AUTH_CSRF_HEADER]: 'e2e' };

/** A request from inside the page: MSW answers it in msw mode, the preview proxy in api mode. */
async function inPage(page: Page, method: 'GET' | 'POST', path: string, body?: unknown) {
  const result = await page.evaluate(
    async ({ method, path, body, headers }) => {
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: (await response.json()) as unknown };
    },
    { method, path, body, headers: CSRF },
  );
  expect(result.status, `${method} ${path}`).toBe(200);
  return result.body;
}

async function toServer(page: Page, origin: string, path: string, data: unknown) {
  const response = await page.request.post(`${origin}${path}`, { data, headers: CSRF });
  expect(response.status(), `POST ${origin}${path}`).toBe(200);
}

/**
 * Moves every clock to `at` (ISO UTC): the page's, and the backend's (MSW's, or apps/api's and
 * apps/realtime's). A backend jump also syncs every paper account (AMO release, end of day).
 * Before the first navigation only the page clock can move in msw mode, which is all MSW needs.
 */
export async function setClock(page: Page, at: string): Promise<void> {
  await page.clock.setFixedTime(new Date(at));
  const body: TestClockRequest = { at };
  if (E2E_MODE === 'api') {
    await toServer(page, API_ORIGIN, TEST_CONTROL_PATHS.clock, body);
    await toServer(page, REALTIME_ORIGIN, TEST_CONTROL_PATHS.clock, body);
  } else if (page.url().startsWith('http')) {
    await inPage(page, 'POST', TEST_CONTROL_PATHS.clock, body);
  }
}

/** A scripted tick: the paper engines see `ltp` paise for `symbol` from now on. */
export async function setPrice(page: Page, symbol: string, ltp: number): Promise<void> {
  const body: TestPriceRequest = { symbol, ltp };
  if (E2E_MODE === 'api') await toServer(page, API_ORIGIN, TEST_CONTROL_PATHS.price, body);
  else await inPage(page, 'POST', TEST_CONTROL_PATHS.price, body);
}

const onTick = (paise: number, round: (n: number) => number = Math.round) =>
  round(paise / TICK_SIZE_PAISE) * TICK_SIZE_PAISE;

/**
 * Prices for a scripted scenario, from the stock's previous close so they sit well inside its
 * ±20% circuit band: `base` on the tick, and `below` about 2% under it.
 */
export async function scriptedPrices(page: Page, symbol: string) {
  const stats = (await inPage(page, 'GET', `/v1/market/instruments/${symbol}/stats`)) as {
    prevClose: number;
  };
  const base = onTick(stats.prevClose);
  return { base, below: onTick(base * 0.98, Math.floor) };
}

/** Paise as the app shows rupees: "₹1,234.50". */
export const inr = (paise: number) =>
  `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(paise / 100)}`;

/** Paise as the price box takes it: "1234.50". */
export const rupees = (paise: number) => (paise / 100).toFixed(2);

import { setupWorker } from 'msw/browser';
import { resolveWsUrl, type RuntimeConfig } from '@/app/config/runtimeConfig';
import { enterDemoMode, isDemoMode, registerSimulator } from '@/shared/lib/demoSimulator';
import { wantsDemo, withoutDemoParam } from './demoParam';
import { seedMockDemo } from './demoSeed';
import { ORDER_SWEEP_MS, createMockHandlers } from './handlers';
import { createMockMarket } from './marketAdapter';
import { createSimulator } from './simulator';
import type { TestControls } from './testControls';
import { startWorkerKeeper } from './workerKeeper';

export { ensureWorkerControl } from './workerControl';

/**
 * Starts MSW in the browser (msw mode only). main.tsx imports this module dynamically behind a
 * build-time mode check, so api-mode builds contain no MSW code at all (T-050).
 */
export type StartMockWorkerOptions = {
  /**
   * Load the demo seed. main.tsx reads `?demo=1` and drops it before the router starts (T-169);
   * without this option the parameter is read, and dropped, here.
   */
  demo?: boolean;
};

export async function startMockWorker(
  config: RuntimeConfig,
  testControls?: TestControls,
  options: StartMockWorkerOptions = {},
) {
  const adapter = createMockMarket({ alwaysOpen: config.mockMarketOpen });
  const wsUrl = resolveWsUrl(config, window.location);
  // The auth mock keeps its users, PINs and trusted devices in localStorage, so "reload and log
  // in with your PIN" works in msw mode (MSW keeps the mocked cookies there too).
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  // Watchlists live in sessionStorage (T-116): a reload keeps them, a new browser session starts
  // from the default list.
  let listStorage: Storage | undefined;
  try {
    listStorage = window.sessionStorage;
  } catch {
    listStorage = undefined;
  }
  // ?demo=1 (T-174): the demo user's watchlists, holdings and ledger, as `npm run seed:demo` gives
  // in api mode. Written before the mocks read their saved state; the parameter is then dropped so
  // a reload keeps the demo's changes.
  const demoRequested = options.demo ?? wantsDemo(window.location.search);
  if (demoRequested) {
    if (listStorage) enterDemoMode(listStorage);
    const seeded = listStorage ? seedMockDemo(listStorage, adapter.master) : false;
    if (wantsDemo(window.location.search)) {
      window.history.replaceState(window.history.state, '', withoutDemoParam(window.location.href));
    }
    console.info(
      seeded
        ? '[MSW] Demo seed loaded (?demo=1): log in as 9000000001 with OTP 123456.'
        : '[MSW] Demo seed skipped: sessionStorage is unavailable.',
    );
  }
  // E2E builds only (VITE_TEST_CONTROLS, T-162): the mocks share the test clock, so auth,
  // watchlists and orders all move when a test sets it.
  const now = testControls ? { now: testControls.now } : {};
  const { handlers, orders, alerts } = createMockHandlers({
    adapter,
    wsUrl,
    auth: { ...now, ...(storage ? { storage } : {}) },
    ...(listStorage ? { watchlists: { storage: listStorage } } : {}),
    // Paper orders too (T-132); the sweep pushes 9:15 AMO release and end of day.
    orders: {
      sweepMs: ORDER_SWEEP_MS,
      // The demo trades at any hour (SPEC-TFC-1 §10.3). E2E builds set the clock themselves and
      // test AMOs at night, so with test controls the engine keeps NSE hours.
      marketHours: config.mockMarketOpen && !testControls ? 'alwaysOpen' : 'nse',
      ...(listStorage ? { storage: listStorage } : {}),
    },
    // Price alerts and notifications (NSTOCK-0344), kept like the orders.
    ...(listStorage ? { alerts: { storage: listStorage } } : {}),
  });
  const worker = setupWorker(
    ...(testControls ? testControls.handlers({ orders, adapter, alerts }) : []),
    ...handlers,
  );
  // Assets, fonts and the Vite client go to the network untouched. MSW's own logging is off
  // because it would print every WebSocket frame (4 a second per symbol); one line says it is on.
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true });
  console.info(
    `[MSW] Mocking enabled (VITE_API_MODE=msw): REST /v1 and ${wsUrl}, mock market ${
      config.mockMarketOpen ? 'forced open (VITE_MOCK_MARKET_OPEN)' : 'on NSE hours'
    }.`,
  );
  if (testControls) console.info('[MSW] Test controls on (VITE_TEST_CONTROLS): E2E build only.');
  // Trailing-stop steps are saved at most every 2 s; a hidden tab may be closed, so save now.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') orders.flush();
  });
  // The Simulator exists only in demo mode (SPEC-TFC-1 TFC-12); a reload in the same session keeps it.
  if (listStorage && isDemoMode(listStorage)) {
    registerSimulator(createSimulator({ adapter, orders }));
  }
  // Chrome stops idle service workers; this re-registers the tab with a restarted one.
  const keeper = startWorkerKeeper();
  return { worker, adapter, orders, ensureActive: keeper.ensureActive };
}

import { setupWorker } from 'msw/browser';
import { resolveWsUrl, type RuntimeConfig } from '@/app/config/runtimeConfig';
import {
  enterDemoMode,
  clearDemoPending,
  isDemoMode,
  markDemoPending,
  registerSimulator,
  setDemoStarter,
} from '@/shared/lib/demoSimulator';
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
  /** Loads a URL in place of the page (Try demo's `?demo=1` reload); tests pass a spy. */
  navigate?: (url: string) => void;
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
  } else if (listStorage) {
    // A Try demo reload carries on only on the ?demo=1 load it started; a flag left by a reload
    // that never landed must not log a later /login in as the demo user.
    clearDemoPending(listStorage);
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
  ignoreWorkerUpdateMiss();
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
  let simulatorOn = false;
  const startSimulator = () => {
    if (simulatorOn) return;
    simulatorOn = true;
    registerSimulator(createSimulator({ adapter, orders }));
  };
  if (listStorage && isDemoMode(listStorage)) startSimulator();
  // Try demo outside demo mode: reload with ?demo=1, so the seed is written before the mocks read
  // their saved state, as on a direct ?demo=1 load; the login page then carries on (TFC-12).
  setDemoStarter(() => {
    if (listStorage && !isDemoMode(listStorage) && markDemoPending(listStorage)) {
      (options.navigate ?? ((url) => window.location.assign(url)))('/login?demo=1');
      return 'reloading';
    }
    startSimulator();
    return 'ready';
  });
  // Chrome stops idle service workers; this re-registers the tab with a restarted one.
  const keeper = startWorkerKeeper();
  return { worker, adapter, orders, ensureActive: keeper.ensureActive };
}

let workerUpdateMissIgnored = false;

/**
 * MSW re-checks an existing worker with `registration.update()` and leaves the promise uncaught.
 * When the page navigates while that check runs, Chrome rejects it ("Failed to update a
 * ServiceWorker ... Not found") although the running worker is fine, and the rejection shows as
 * an uncaught error in the console (NSTOCK-0361). Only that rejection is silenced.
 */
function ignoreWorkerUpdateMiss() {
  if (workerUpdateMissIgnored) return;
  workerUpdateMissIgnored = true;
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    if (
      reason instanceof Error &&
      reason.message.startsWith('Failed to update a ServiceWorker') &&
      reason.message.includes('mockServiceWorker.js')
    ) {
      event.preventDefault();
    }
  });
}

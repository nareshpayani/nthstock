import { setupWorker } from 'msw/browser';
import { resolveWsUrl, type RuntimeConfig } from '@/app/runtimeConfig';
import { createHandlers } from './handlers';
import { createMockMarket } from './marketAdapter';

/**
 * Starts MSW in the browser (msw mode only). main.tsx imports this module dynamically behind a
 * build-time mode check, so api-mode builds contain no MSW code at all (T-050).
 */
export async function startMockWorker(config: RuntimeConfig) {
  const adapter = createMockMarket({ alwaysOpen: config.mockMarketOpen });
  const wsUrl = resolveWsUrl(config, window.location);
  const worker = setupWorker(...createHandlers({ adapter, wsUrl }));
  // Assets, fonts and the Vite client go to the network untouched. MSW's own logging is off
  // because it would print every WebSocket frame (4 a second per symbol); one line says it is on.
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
  console.info(
    `[MSW] Mocking enabled (VITE_API_MODE=msw): REST /v1 and ${wsUrl}, mock market ${
      config.mockMarketOpen ? 'forced open (VITE_MOCK_MARKET_OPEN)' : 'on NSE hours'
    }.`,
  );
  return { worker, adapter };
}

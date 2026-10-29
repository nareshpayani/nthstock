import './styles/app.css';
import { systemClock } from '@nthstock/utils';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { createLiveQuotes } from './app/live/liveQuotes';
import { afterFirstPaint } from './app/firstPaint';
import { AppProviders } from './app/providers/AppProviders';
import { createQueryClient } from './app/queryClient';
import { createAppRouter } from './app/router/router';
import { parseRuntimeConfig } from './app/config/runtimeConfig';
import { writeTradingCommit } from './app/live/tradingCache';
import { bindTradingSession } from './app/live/tradingSession';
import { restSnapshot, startVisibilitySync } from './app/live/visibilitySync';
import { startConnectivity } from './shared/lib/connectivity';
import { installOrderSoundUnlock } from './shared/motion/orderSounds';
import { installStaleBuildReload } from './app/staleBuild';
import { wantsDemo, withoutDemoParam } from './mocks/demoParam';
import { setMockBackendStart } from './shared/lib/demoSimulator';
import { createSessionApiClient } from './shared/lib/sessionClient';
import {
  assumeSignedOutWithoutHint,
  knownSignedOut,
  useSessionStore,
} from './shared/lib/sessionStore';

// Zod would otherwise probe `new Function` once, which the CSP (script-src 'self') reports as a
// violation; its interpreter is plenty fast for this app's payloads.
z.config({ jitless: true });

// Fails fast on an invalid VITE_API_MODE or URL (T-049).
const config = parseRuntimeConfig(import.meta.env);

/**
 * msw mode: loads the lazy MSW + mock-market chunk and starts the worker, once the first page has
 * painted (T-169, NSTOCK-0469). The REST client and the quote socket wait for the returned promise;
 * the shell, header and hero do not. It resolves to `ensureActive`, which the REST client runs
 * before each request so a service worker Chrome stopped while the tab sat idle is mocking again.
 * After a hard reload the worker does not control the page at all, so the page reloads once
 * instead.
 */
async function startMocks(demo: boolean): Promise<() => Promise<void>> {
  const { startMockWorker, ensureWorkerControl } = await import('./mocks/browser');
  // E2E builds only (T-162): VITE_TEST_CONTROLS is a build-time constant too, so every other
  // build drops this import and has no /v1/__test handler (scripts/checkBuild.mjs checks).
  const testControls =
    import.meta.env.VITE_TEST_CONTROLS === 'true'
      ? (await import('./mocks/testControls')).createTestControls()
      : undefined;
  const { ensureActive } = await startMockWorker(config, testControls, { demo });
  // After a hard reload the worker is not in control, so reload once; hold every request until then.
  let storage: Storage | undefined;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = undefined;
  }
  const control = ensureWorkerControl({
    serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    reload: () => {
      window.location.reload();
    },
    storage,
  });
  if (control === 'reloading') await new Promise<never>(() => undefined);
  return ensureActive;
}

function boot() {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root not found');
  }
  // A tab older than the last deploy reloads to the current build instead of a broken page.
  installStaleBuildReload();
  // Order sounds (A17) need audio opened inside a gesture: the first tap or key press does it.
  installOrderSoundUnlock();

  // VITE_API_MODE is a build-time constant (vite.config.ts), so in an api-mode build this branch
  // and the MSW chunk it imports are removed entirely (T-050), and nothing is gated.
  let mocksReady: Promise<unknown> | undefined;
  let startAfter: ((ready: Promise<void>) => void) | undefined;
  let beforeRequest: (() => Promise<unknown>) | undefined;
  if (import.meta.env.VITE_API_MODE === 'msw') {
    // `?demo=1` is read and dropped here, before the router starts (T-174).
    const demo = wantsDemo(window.location.search);
    if (demo) {
      window.history.replaceState(window.history.state, '', withoutDemoParam(window.location.href));
    } else {
      assumeSignedOutWithoutHint();
    }
    // A signed-out visitor's first page paints without mock data, so the mock market is built after
    // it; a signed-in one needs the worker at once for the session refresh.
    const firstPage = new Promise<void>((resolve) => {
      if (knownSignedOut()) startAfter = (ready) => void ready.then(resolve);
      else resolve();
    });
    const started = firstPage.then(() => startMocks(demo));
    mocksReady = started;
    setMockBackendStart(started);
    beforeRequest = () => started.then((ensureActive) => ensureActive());
    started.catch((error: unknown) => {
      console.error('The mock worker did not start; requests go to the network.', error);
    });
  }

  const queryClient = createQueryClient();
  // Sends the CSRF token and refreshes an expired session once on a 401 (T-089).
  const apiClient = createSessionApiClient({
    baseUrl: config.apiBaseUrl,
    ...(beforeRequest ? { ready: beforeRequest } : {}),
  });
  const router = createAppRouter({ queryClient, apiClient });
  startAfter?.(afterFirstPaint(router));
  // The trading store (ADR 0012): both backends send account frames (NSTOCK-0368).
  const { wsClient, quoteStore, orderUpdates, tradingStore } = createLiveQuotes(
    config,
    window.location,
    mocksReady,
    {
      loadState: () => apiClient.request('accountState'),
      onCommit: (commit) => {
        writeTradingCommit(queryClient, commit);
      },
    },
  );
  if (tradingStore)
    bindTradingSession({ store: tradingStore, sessions: useSessionStore, document });
  // Background tabs keep only the active watchlist live; focus and reconnects resync (T-077).
  // Offline (SPEC-CR-1 §7): the browser says so, or the socket has been down for over 3 s.
  startConnectivity({ target: window, navigator: window.navigator, socket: wsClient });
  startVisibilitySync({
    document,
    quoteStore,
    wsClient,
    fetchSnapshot: restSnapshot(apiClient),
  });

  createRoot(rootElement).render(
    <StrictMode>
      <AppProviders
        queryClient={queryClient}
        quoteStore={quoteStore}
        orderUpdates={orderUpdates}
        {...(tradingStore ? { tradingStore } : {})}
        apiClient={apiClient}
        // The forced-open mock market (VITE_MOCK_MARKET_OPEN) shows LIVE badges at any hour.
        marketSession={{
          clock: systemClock,
          alwaysOpen: config.apiMode === 'msw' && config.mockMarketOpen,
        }}
      >
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
}

boot();

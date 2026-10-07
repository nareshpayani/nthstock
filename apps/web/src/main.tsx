import './styles/app.css';
import { systemClock } from '@nthstock/utils';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { createLiveQuotes } from './app/live/liveQuotes';
import { AppProviders } from './app/providers/AppProviders';
import { createQueryClient } from './app/queryClient';
import { createAppRouter } from './app/router/router';
import { parseRuntimeConfig } from './app/config/runtimeConfig';
import { restSnapshot, startVisibilitySync } from './app/live/visibilitySync';
import { wantsDemo, withoutDemoParam } from './mocks/demoParam';
import { createSessionApiClient } from './shared/lib/sessionClient';

// Zod would otherwise probe `new Function` once, which the CSP (script-src 'self') reports as a
// violation; its interpreter is plenty fast for this app's payloads.
z.config({ jitless: true });

// Fails fast on an invalid VITE_API_MODE or URL (T-049).
const config = parseRuntimeConfig(import.meta.env);

/**
 * msw mode: loads the lazy MSW + mock-market chunk and starts the worker, beside the first render
 * (T-169). The REST client and the quote socket wait for the returned promise; the shell, header
 * and hero do not. It resolves to `ensureActive`, which the REST client runs before each request
 * so a service worker Chrome stopped while the tab sat idle is mocking again. After a hard reload
 * the worker does not control the page at all, so the page reloads once instead. `?demo=1` is read
 * and dropped here, before the router starts (T-174).
 */
async function startMocks(): Promise<() => Promise<void>> {
  const demo = wantsDemo(window.location.search);
  if (demo) {
    window.history.replaceState(window.history.state, '', withoutDemoParam(window.location.href));
  }
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

  // VITE_API_MODE is a build-time constant (vite.config.ts), so in an api-mode build this branch
  // and the MSW chunk it imports are removed entirely (T-050), and nothing is gated.
  let mocksReady: Promise<unknown> | undefined;
  let beforeRequest: (() => Promise<unknown>) | undefined;
  if (import.meta.env.VITE_API_MODE === 'msw') {
    const started = startMocks();
    mocksReady = started;
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
  const { wsClient, quoteStore, orderUpdates } = createLiveQuotes(
    config,
    window.location,
    mocksReady,
  );
  // Background tabs keep only the active watchlist live; focus and reconnects resync (T-077).
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

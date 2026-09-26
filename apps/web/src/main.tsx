import './styles/app.css';
import { createApiClient } from '@nthstock/apiClient';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createLiveQuotes } from './app/liveQuotes';
import { AppProviders } from './app/providers/AppProviders';
import { createQueryClient } from './app/queryClient';
import { createAppRouter } from './app/router';
import { parseRuntimeConfig } from './app/runtimeConfig';
import { restSnapshot, startVisibilitySync } from './app/visibilitySync';

// Fails fast on an invalid VITE_API_MODE or URL (T-049).
const config = parseRuntimeConfig(import.meta.env);

async function boot() {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root not found');
  }

  // VITE_API_MODE is a build-time constant (vite.config.ts), so in an api-mode build this branch
  // and the MSW chunk it imports are removed entirely (T-050).
  if (import.meta.env.VITE_API_MODE === 'msw') {
    const { startMockWorker } = await import('./mocks/browser');
    await startMockWorker(config);
  }

  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient);
  const { wsClient, quoteStore } = createLiveQuotes(config, window.location);
  // Background tabs keep only the active watchlist live; focus and reconnects resync (T-077).
  startVisibilitySync({
    document,
    quoteStore,
    wsClient,
    fetchSnapshot: restSnapshot(createApiClient({ baseUrl: config.apiBaseUrl })),
  });

  createRoot(rootElement).render(
    <StrictMode>
      <AppProviders queryClient={queryClient} quoteStore={quoteStore}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
}

void boot();

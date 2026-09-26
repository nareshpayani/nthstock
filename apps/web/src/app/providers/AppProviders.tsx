import type { ApiClient, QuoteStore } from '@nthstock/apiClient';
import { ToastProvider, TooltipProvider } from '@nthstock/ui';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiClientContext } from '@/shared/lib/apiClientContext';
import { MarketSessionContext, type MarketSession } from '@/shared/lib/marketSessionContext';
import { QuoteStoreContext } from '@/shared/lib/quoteStoreContext';

export type AppProvidersProps = {
  queryClient: QueryClient;
  /** Live prices. Without one, price cells stay in their loading state (tests, Storybook). */
  quoteStore?: QuoteStore;
  /** Typed REST client. Without one, a same-origin client is used. */
  apiClient?: ApiClient;
  /** Clock and forced-open flag for "is the market open" (LIVE badges). System clock by default. */
  marketSession?: MarketSession;
  children: ReactNode;
};

/**
 * App-wide providers: server state, REST client, live quotes, market session, tooltips and
 * toasts. The router sits inside.
 */
export function AppProviders({
  queryClient,
  quoteStore,
  apiClient,
  marketSession,
  children,
}: AppProvidersProps) {
  let content = (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
  if (marketSession) {
    content = (
      <MarketSessionContext.Provider value={marketSession}>{content}</MarketSessionContext.Provider>
    );
  }
  if (apiClient) {
    content = <ApiClientContext.Provider value={apiClient}>{content}</ApiClientContext.Provider>;
  }
  return quoteStore ? (
    <QuoteStoreContext.Provider value={quoteStore}>{content}</QuoteStoreContext.Provider>
  ) : (
    content
  );
}

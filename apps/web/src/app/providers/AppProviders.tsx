import type { QuoteStore } from '@nthstock/apiClient';
import { ToastProvider, TooltipProvider } from '@nthstock/ui';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { QuoteStoreContext } from '@/shared/lib/quoteStoreContext';

export type AppProvidersProps = {
  queryClient: QueryClient;
  /** Live prices. Without one, price cells stay in their loading state (tests, Storybook). */
  quoteStore?: QuoteStore;
  children: ReactNode;
};

/** App-wide providers: server state, live quotes, tooltips and toasts. The router sits inside. */
export function AppProviders({ queryClient, quoteStore, children }: AppProvidersProps) {
  const content = (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
  return quoteStore ? (
    <QuoteStoreContext.Provider value={quoteStore}>{content}</QuoteStoreContext.Provider>
  ) : (
    content
  );
}

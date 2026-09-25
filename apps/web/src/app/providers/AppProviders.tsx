import { ToastProvider, TooltipProvider } from '@nthstock/ui';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

export type AppProvidersProps = {
  queryClient: QueryClient;
  children: ReactNode;
};

/** App-wide providers: server state, tooltips and toasts. The router sits inside these. */
export function AppProviders({ queryClient, children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

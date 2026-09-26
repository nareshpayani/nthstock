import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query defaults (ADR 0005): server state only lives here. Market data refreshes through
 * the WebSocket quote store, so queries do not refetch on window focus.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  });
}

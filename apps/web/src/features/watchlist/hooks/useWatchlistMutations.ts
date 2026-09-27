import type { SearchHit, Watchlist, WatchlistsResponse } from '@nthstock/contracts';
import { useToast } from '@nthstock/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { WATCHLIST_MUTATION_KEY, watchlistKeys } from '../api/watchlistsQuery';
import {
  withItemAdded,
  withItemRemoved,
  withItemsReordered,
  OPTIMISTIC_ID_PREFIX,
  withCreatedList,
  withListAdded,
  withListDeleted,
  withListFromServer,
  withListRenamed,
  withListsReordered,
} from '../model/optimistic';
import { watchlistErrorToast, type WatchlistAction } from '../model/watchlistError';

type Snapshot = { previous: WatchlistsResponse | undefined };

type OptimisticConfig<V, R> = {
  action: WatchlistAction;
  request: (variables: V) => Promise<R>;
  /** The cache as it should look while the request is in flight. */
  optimistic: (data: WatchlistsResponse, variables: V) => WatchlistsResponse;
  /** The cache once the server answered; default: leave the optimistic state. */
  settle?: (data: WatchlistsResponse, result: R, variables: V) => WatchlistsResponse;
  /** The stock a toast names (add and remove). */
  symbolOf?: (variables: V) => string;
};

/**
 * One optimistic watchlist change (T-118): the cache changes at once, a failure puts it back and
 * shows a toast, and the last change to settle refetches the lists so the cache matches the server.
 */
function useOptimisticWatchlistMutation<V, R>(config: OptimisticConfig<V, R>) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = watchlistKeys.lists();

  return useMutation<R, unknown, V, Snapshot>({
    mutationKey: WATCHLIST_MUTATION_KEY,
    mutationFn: config.request,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WatchlistsResponse>(key);
      if (previous) queryClient.setQueryData(key, config.optimistic(previous, variables));
      return { previous };
    },
    onError: (error, variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.show({
        ...watchlistErrorToast(config.action, error, config.symbolOf?.(variables)),
        tone: 'error',
      });
    },
    onSuccess: (result, variables) => {
      const { settle } = config;
      if (!settle) return;
      queryClient.setQueryData<WatchlistsResponse>(key, (data) =>
        data ? settle(data, result, variables) : data,
      );
    },
    onSettled: async () => {
      // Another change still in flight will refetch when it settles; refetching now could bring
      // back a state older than its optimistic update.
      if (queryClient.isMutating({ mutationKey: WATCHLIST_MUTATION_KEY }) === 1) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

let optimisticIds = 0;

/** Create a list; it shows at the end at once, under a temporary id until the server answers. */
export function useCreateWatchlist() {
  const apiClient = useApiClient();
  return useOptimisticWatchlistMutation({
    action: 'create',
    request: ({ name }: { name: string }) =>
      apiClient.request('watchlistCreate', { body: { name } }),
    optimistic: (data, { name }) => {
      const now = new Date().toISOString();
      return withListAdded(data, {
        id: `${OPTIMISTIC_ID_PREFIX}${String((optimisticIds += 1))}`,
        name: name.trim(),
        items: [],
        createdAt: now,
        updatedAt: now,
      });
    },
    settle: (data, list: Watchlist) => withCreatedList(data, list),
  });
}

export function useRenameWatchlist() {
  const apiClient = useApiClient();
  return useOptimisticWatchlistMutation({
    action: 'rename',
    request: ({ id, name }: { id: string; name: string }) =>
      apiClient.request('watchlistRename', { params: { id }, body: { name } }),
    optimistic: (data, { id, name }) => withListRenamed(data, id, name.trim()),
    settle: (data, list: Watchlist) => withListFromServer(data, list),
  });
}

export function useDeleteWatchlist() {
  const apiClient = useApiClient();
  return useOptimisticWatchlistMutation({
    action: 'delete',
    request: ({ id }: { id: string }) => apiClient.request('watchlistDelete', { params: { id } }),
    optimistic: (data, { id }) => withListDeleted(data, id),
  });
}

export function useReorderWatchlists() {
  const apiClient = useApiClient();
  return useOptimisticWatchlistMutation({
    action: 'reorder',
    request: ({ ids }: { ids: string[] }) =>
      apiClient.request('watchlistsReorder', { body: { ids } }),
    optimistic: (data, { ids }) => withListsReordered(data, ids),
    settle: (_data, lists: WatchlistsResponse) => lists,
  });
}

/** What adding needs: the list and the stock as search shows it, so the row can render at once. */
export type AddToWatchlistInput = {
  listId: string;
  stock: Pick<SearchHit, 'token' | 'symbol' | 'exchange' | 'name'>;
};

export function useAddToWatchlist() {
  const apiClient = useApiClient();
  return useOptimisticWatchlistMutation({
    action: 'add',
    request: ({ listId, stock }: AddToWatchlistInput) =>
      apiClient.request('watchlistItemAdd', {
        params: { id: listId },
        body: { token: stock.token },
      }),
    optimistic: (data, { listId, stock }) =>
      withItemAdded(data, listId, {
        token: stock.token,
        symbol: stock.symbol,
        exchange: stock.exchange,
        name: stock.name,
        addedAt: new Date().toISOString(),
      }),
    settle: (data, list: Watchlist) => withListFromServer(data, list),
    symbolOf: ({ stock }) => stock.symbol,
  });
}

export type RemoveFromWatchlistInput = { listId: string; token: number; symbol?: string };

export function useRemoveFromWatchlist() {
  const apiClient = useApiClient();
  return useOptimisticWatchlistMutation({
    action: 'remove',
    request: ({ listId, token }: RemoveFromWatchlistInput) =>
      apiClient.request('watchlistItemRemove', { params: { id: listId, token } }),
    optimistic: (data, { listId, token }) => withItemRemoved(data, listId, token),
    settle: (data, list: Watchlist) => withListFromServer(data, list),
    symbolOf: ({ symbol }) => symbol ?? '',
  });
}

export function useReorderWatchlistItems() {
  const apiClient = useApiClient();
  return useOptimisticWatchlistMutation({
    action: 'reorder',
    request: ({ listId, tokens }: { listId: string; tokens: number[] }) =>
      apiClient.request('watchlistItemsReorder', { params: { id: listId }, body: { tokens } }),
    optimistic: (data, { listId, tokens }) => withItemsReordered(data, listId, tokens),
    settle: (data, list: Watchlist) => withListFromServer(data, list),
  });
}

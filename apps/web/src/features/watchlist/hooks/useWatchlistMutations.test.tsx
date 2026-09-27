import type { ApiClient } from '@nthstock/apiClient';
import { DEV_OTP, WATCHLIST_MESSAGES, type SearchHit } from '@nthstock/contracts';
import { fixedClock, fromIst } from '@nthstock/utils';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useEffect } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '@/mocks/node';
import { createSessionApiClient } from '@/shared/lib/sessionClient';
import { renderWithProviders } from '@/test/renderWithProviders';
import { resetSession, signIn } from '@/test/session';
import { useWatchlists } from './useWatchlists';
import {
  useAddToWatchlist,
  useCreateWatchlist,
  useDeleteWatchlist,
  useRemoveFromWatchlist,
  useRenameWatchlist,
  useReorderWatchlistItems,
  useReorderWatchlists,
} from './useWatchlistMutations';

const ORIGIN = 'http://watchlists.test';
const { server, adapter } = createMockServer({ clock: fixedClock(fromIst(2026, 9, 25, 16 * 60)) });

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  delete sink.hooks;
  server.resetHandlers();
  resetSession();
});
afterAll(() => {
  server.close();
  adapter.dispose();
});

function useAll() {
  return {
    lists: useWatchlists(),
    create: useCreateWatchlist(),
    rename: useRenameWatchlist(),
    remove: useDeleteWatchlist(),
    reorder: useReorderWatchlists(),
    add: useAddToWatchlist(),
    removeItem: useRemoveFromWatchlist(),
    reorderItems: useReorderWatchlistItems(),
  };
}

const sink: { hooks?: ReturnType<typeof useAll> } = {};

/** Shows each list as "<name>: <symbols>" so tests read the cache the way a user would. */
function Probe({ onRender }: { onRender: (hooks: ReturnType<typeof useAll>) => void }) {
  const all = useAll();
  useEffect(() => {
    onRender(all);
  });
  return (
    <ul aria-label="lists">
      {all.lists.data?.items.map((list) => (
        <li key={list.id}>{`${list.name}: ${list.items.map((i) => i.symbol).join(',')}`}</li>
      ))}
    </ul>
  );
}

const capture = (hooks: ReturnType<typeof useAll>) => {
  sink.hooks = hooks;
};

const current = () => {
  if (!sink.hooks) throw new Error('Probe not rendered');
  return sink.hooks;
};

const rows = () => within(screen.getByRole('list', { name: 'lists' })).queryAllByRole('listitem');
const rowTexts = () => rows().map((row) => row.textContent);

/** Logs `mobile` in on the mock server and answers the session-aware client. */
async function login(mobile: string): Promise<ApiClient> {
  const apiClient = createSessionApiClient({ baseUrl: ORIGIN });
  const { requestId } = await apiClient.request('otpRequest', { body: { mobile } });
  signIn(await apiClient.request('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } }));
  return apiClient;
}

async function stock(apiClient: ApiClient, symbol: string): Promise<SearchHit> {
  const { items } = await apiClient.request('marketSearch', { query: { q: symbol, limit: 5 } });
  const hit = items.find((item) => item.symbol === symbol);
  if (!hit) throw new Error(`${symbol} not found`);
  return hit;
}

/** A promise the test resolves to let a held request answer. */
function gate() {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

async function renderSignedIn(mobile: string) {
  const apiClient = await login(mobile);
  const view = renderWithProviders(<Probe onRender={capture} />, { apiClient });
  await waitFor(() => expect(rowTexts()).toEqual(['My Watchlist: ']));
  const listId = current().lists.data?.items[0]?.id ?? '';
  return { ...view, apiClient, listId };
}

// Each case logs in and runs several round trips on the MSW node server; CI runners are slow.
const HEAVY = 20_000;

describe('watchlist Query hooks (T-118)', () => {
  it('stays idle while logged out', async () => {
    renderWithProviders(<Probe onRender={capture} />);
    await waitFor(() => expect(sink.hooks).toBeDefined());
    expect(current().lists.fetchStatus).toBe('idle');
    expect(rows()).toHaveLength(0);
  });

  it(
    'shows an added stock at once and keeps it when the server agrees',
    async () => {
      const { apiClient, listId } = await renderSignedIn('9811100001');
      const infy = await stock(apiClient, 'INFY');
      const held = gate();
      server.use(
        http.post('*/v1/watchlists/:id/items', async () => {
          await held.opened;
          return undefined; // fall through to the real handler
        }),
      );

      act(() => {
        current().add.mutate({ listId, stock: infy });
      });
      await waitFor(() => expect(rowTexts()).toEqual(['My Watchlist: INFY']));
      held.open();
      await waitFor(() => expect(current().add.isSuccess).toBe(true));
      expect(rowTexts()).toEqual(['My Watchlist: INFY']);
    },
    HEAVY,
  );

  it(
    'rolls back a failed add and shows a toast',
    async () => {
      const { apiClient, listId } = await renderSignedIn('9811100002');
      const infy = await stock(apiClient, 'INFY');
      const held = gate();
      server.use(
        http.post('*/v1/watchlists/:id/items', async () => {
          await held.opened;
          return HttpResponse.json(
            { error: { code: 'LIMIT_REACHED', message: WATCHLIST_MESSAGES.itemLimit } },
            { status: 409 },
          );
        }),
      );

      act(() => {
        current().add.mutate({ listId, stock: infy });
      });
      await waitFor(() => expect(rowTexts()).toEqual(['My Watchlist: INFY']));
      held.open();

      expect(await screen.findByText("Couldn't add INFY")).toBeInTheDocument();
      expect(screen.getByText(WATCHLIST_MESSAGES.itemLimit)).toBeInTheDocument();
      expect(rowTexts()).toEqual(['My Watchlist: ']);
    },
    HEAVY,
  );

  it(
    'rolls back a failed rename and names the rule in the toast',
    async () => {
      const { listId } = await renderSignedIn('9811100003');
      act(() => {
        current().create.mutate({ name: 'Banks' });
      });
      await waitFor(() => expect(current().create.isSuccess).toBe(true));

      act(() => {
        current().rename.mutate({ id: listId, name: 'banks' });
      });
      expect(await screen.findByText("Couldn't rename the watchlist")).toBeInTheDocument();
      expect(screen.getByText(WATCHLIST_MESSAGES.duplicateName)).toBeInTheDocument();
      await waitFor(() => expect(rowTexts()).toEqual(['My Watchlist: ', 'Banks: ']));
    },
    HEAVY,
  );

  it(
    'creates, renames, reorders and deletes lists and items, ending in the server state',
    async () => {
      const { apiClient, listId, queryClient } = await renderSignedIn('9811100004');
      const settled = () => waitFor(() => expect(queryClient.isMutating()).toBe(0));
      const [infy, tcs] = [await stock(apiClient, 'INFY'), await stock(apiClient, 'TCS')];

      act(() => {
        current().create.mutate({ name: ' Banks ' });
      });
      // The new list shows at once under a stand-in id, then under the server's id.
      await waitFor(() => expect(rowTexts()).toEqual(['My Watchlist: ', 'Banks: ']));
      await waitFor(() => expect(current().create.isSuccess).toBe(true));
      const banks = current().create.data?.id ?? '';
      expect(current().lists.data?.items.map((l) => l.id)).toEqual([listId, banks]);

      act(() => {
        current().add.mutate({ listId, stock: infy });
        current().add.mutate({ listId, stock: tcs });
      });
      await waitFor(() => expect(rowTexts()).toEqual(['My Watchlist: INFY,TCS', 'Banks: ']));
      await settled();

      act(() => {
        current().reorderItems.mutate({ listId, tokens: [tcs.token, infy.token] });
        current().reorder.mutate({ ids: [banks, listId] });
        current().rename.mutate({ id: banks, name: 'PSU banks' });
      });
      await waitFor(() => expect(rowTexts()).toEqual(['PSU banks: ', 'My Watchlist: TCS,INFY']));
      await settled();

      act(() => {
        current().removeItem.mutate({ listId, token: tcs.token, symbol: 'TCS' });
        current().remove.mutate({ id: banks });
      });
      await waitFor(() => expect(rowTexts()).toEqual(['My Watchlist: INFY']));

      // After the last change settles, the lists are refetched and match the server.
      await settled();
      await waitFor(() => expect(current().lists.isFetching).toBe(false));
      const server = await apiClient.request('watchlistsList');
      expect(server.items.map((l) => [l.name, l.items.map((i) => i.symbol)])).toEqual([
        ['My Watchlist', ['INFY']],
      ]);
      expect(rowTexts()).toEqual(['My Watchlist: INFY']);
    },
    HEAVY,
  );
});

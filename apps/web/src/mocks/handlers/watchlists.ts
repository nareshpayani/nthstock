import {
  WATCHLIST_DEFAULT_NAME,
  WATCHLIST_MAX_ITEMS,
  WATCHLIST_MAX_LISTS,
  WATCHLIST_MESSAGES,
  sameWatchlistName,
  type Instrument,
  type RouteName,
  type Watchlist,
} from '@nthstock/contracts';
import type { MarketDataAdapter } from '@nthstock/marketData';
import type { HttpHandler } from 'msw';
import {
  MockApiError,
  defineRoute,
  type ResolverContext,
  type RouteHandlerOptions,
  type RouteResolver,
} from '../handlerKit';
import type { AuthMock } from './auth';

/**
 * MSW watchlist handlers (T-116) with the same rules as apps/api (T-115): an empty "My Watchlist"
 * on the user's first watchlist call, at most 10 lists of 50 stocks, unique names ignoring case, a
 * stock once per list, the last list cannot be deleted, and a reorder must name exactly the current
 * lists or stocks. Messages come from `WATCHLIST_MESSAGES`, so both backends answer word for word.
 *
 * State lives in memory; in the browser it is also saved to sessionStorage (see `storage`), so a
 * reload keeps the lists. Every storage call sits in try/catch: without storage the mock starts
 * fresh and still works.
 */

/** sessionStorage key of the persisted watchlist mock state. */
export const WATCHLIST_MOCK_STORAGE_KEY = 'nthstock.msw.watchlists';

export type WatchlistMockOptions = {
  /** Epoch ms; tests inject a clock. */
  now?: () => number;
  /** Where to keep the lists between page loads (the browser passes sessionStorage). */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
};

/** Lists by user id, each in display order. Timestamps are ISO strings, as the API sends them. */
type State = Record<string, Watchlist[]>;

const randomId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `wl_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};

const samePermutation = <T>(current: readonly T[], wanted: readonly T[]) =>
  current.length === wanted.length && wanted.every((value) => current.includes(value));

const watchlistGone = () => new MockApiError(404, 'NOT_FOUND', WATCHLIST_MESSAGES.notFound);
const conflict = (message: string) => new MockApiError(409, 'CONFLICT', message);
const limitReached = (message: string) => new MockApiError(409, 'LIMIT_REACHED', message);

function load(storage: WatchlistMockOptions['storage']): State {
  try {
    const saved = storage?.getItem(WATCHLIST_MOCK_STORAGE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : null;
    // The mock wrote this itself; anything that is not a plain object is ignored.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as State;
  } catch {
    // Start fresh.
  }
  return {};
}

/** The in-memory watchlist backend behind the handlers; exported for tests. */
export function createWatchlistMock(
  adapter: Pick<MarketDataAdapter, 'listInstruments'>,
  auth: Pick<AuthMock, 'userIdOf'>,
  { now = Date.now, storage }: WatchlistMockOptions = {},
) {
  let state: State = load(storage);

  const save = () => {
    if (!storage) return;
    try {
      storage.setItem(WATCHLIST_MOCK_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage is a convenience; the in-memory state still works.
    }
  };

  let instruments: Promise<Map<number, Instrument>> | null = null;
  const instrumentByToken = async (token: number) => {
    instruments ??= adapter
      .listInstruments()
      .then((list) => new Map(list.map((instrument) => [instrument.token, instrument])));
    return (await instruments).get(token) ?? null;
  };

  const iso = () => new Date(now()).toISOString();

  /**
   * Runs `change` on a copy of the user's lists (the default list on first use) and keeps the
   * result only when it succeeds, as apps/api's repo does.
   */
  function update<T>(
    userId: string,
    change: (lists: Watchlist[]) => { lists: Watchlist[]; result: T },
  ): T {
    const at = iso();
    const current = state[userId] ?? [
      { id: randomId(), name: WATCHLIST_DEFAULT_NAME, items: [], createdAt: at, updatedAt: at },
    ];
    const { lists, result } = change(structuredClone(current));
    state = { ...state, [userId]: lists };
    save();
    return structuredClone(result);
  }

  function updateList(
    userId: string,
    id: string,
    change: (list: Watchlist, lists: Watchlist[]) => void,
  ) {
    return update(userId, (lists) => {
      const list = lists.find((l) => l.id === id);
      if (!list) throw watchlistGone();
      change(list, lists);
      list.updatedAt = iso();
      return { lists, result: list };
    });
  }

  const assertNameFree = (lists: readonly Watchlist[], name: string, exceptId?: string) => {
    if (lists.some((l) => l.id !== exceptId && sameWatchlistName(l.name, name))) {
      throw conflict(WATCHLIST_MESSAGES.duplicateName);
    }
  };

  const userOf = (context: Pick<ResolverContext<RouteName>, 'request' | 'cookies'>) =>
    auth.userIdOf(context);

  const handlers = (options: RouteHandlerOptions = {}): HttpHandler[] => {
    const route = <N extends RouteName>(name: N, resolver: RouteResolver<N>) =>
      defineRoute(name, resolver, options);
    return [
      route('watchlistsList', (context) =>
        update(userOf(context), (lists) => ({ lists, result: { items: lists } })),
      ),

      route('watchlistCreate', (context) =>
        update(userOf(context), (lists) => {
          if (lists.length >= WATCHLIST_MAX_LISTS) throw limitReached(WATCHLIST_MESSAGES.listLimit);
          assertNameFree(lists, context.body.name);
          const at = iso();
          const list: Watchlist = {
            id: randomId(),
            name: context.body.name,
            items: [],
            createdAt: at,
            updatedAt: at,
          };
          return { lists: [...lists, list], result: list };
        }),
      ),

      route('watchlistsReorder', (context) =>
        update(userOf(context), (lists) => {
          const { ids } = context.body;
          if (
            !samePermutation(
              lists.map((l) => l.id),
              ids,
            )
          ) {
            throw conflict(WATCHLIST_MESSAGES.staleOrder);
          }
          const byId = new Map(lists.map((l) => [l.id, l]));
          const ordered = ids.flatMap((id) => byId.get(id) ?? []);
          return { lists: ordered, result: { items: ordered } };
        }),
      ),

      route('watchlistRename', (context) =>
        updateList(userOf(context), context.params.id, (list, lists) => {
          assertNameFree(lists, context.body.name, list.id);
          list.name = context.body.name;
        }),
      ),

      route('watchlistDelete', (context) =>
        update(userOf(context), (lists) => {
          const { id } = context.params;
          if (!lists.some((l) => l.id === id)) throw watchlistGone();
          if (lists.length === 1) throw conflict(WATCHLIST_MESSAGES.lastList);
          return { lists: lists.filter((l) => l.id !== id), result: { ok: true as const } };
        }),
      ),

      route('watchlistItemAdd', async (context) => {
        const userId = userOf(context);
        const { token } = context.body;
        const instrument = await instrumentByToken(token);
        return updateList(userId, context.params.id, (list) => {
          // An unknown list answers 404 before an unknown stock, as in apps/api.
          if (!instrument)
            throw new MockApiError(404, 'NOT_FOUND', WATCHLIST_MESSAGES.unknownStock);
          if (list.items.some((item) => item.token === token)) {
            throw conflict(WATCHLIST_MESSAGES.duplicateItem(instrument.symbol));
          }
          if (list.items.length >= WATCHLIST_MAX_ITEMS) {
            throw limitReached(WATCHLIST_MESSAGES.itemLimit);
          }
          list.items.push({
            token,
            symbol: instrument.symbol,
            exchange: instrument.exchange,
            name: instrument.name,
            addedAt: iso(),
          });
        });
      }),

      route('watchlistItemRemove', (context) =>
        updateList(userOf(context), context.params.id, (list) => {
          const index = list.items.findIndex((item) => item.token === context.params.token);
          if (index < 0) {
            throw new MockApiError(404, 'NOT_FOUND', WATCHLIST_MESSAGES.itemNotInList);
          }
          list.items.splice(index, 1);
        }),
      ),

      route('watchlistItemsReorder', (context) =>
        updateList(userOf(context), context.params.id, (list) => {
          const { tokens } = context.body;
          if (
            !samePermutation(
              list.items.map((item) => item.token),
              tokens,
            )
          ) {
            throw conflict(WATCHLIST_MESSAGES.staleOrder);
          }
          const byToken = new Map(list.items.map((item) => [item.token, item]));
          list.items = tokens.flatMap((token) => byToken.get(token) ?? []);
        }),
      ),
    ];
  };

  return { handlers };
}

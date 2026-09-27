import { randomUUID } from 'node:crypto';
import {
  WATCHLIST_DEFAULT_NAME,
  WATCHLIST_MAX_ITEMS,
  WATCHLIST_MAX_LISTS,
  WATCHLIST_MESSAGES,
  sameWatchlistName,
  type Instrument,
  type Watchlist,
} from '@nthstock/contracts';
import type { MarketDataAdapter } from '@nthstock/marketData';
import type { Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { WatchlistsRepo } from './repo.js';
import type { WatchlistRecord } from './schema.js';

export type WatchlistServiceDeps = {
  clock: Clock;
  repo: WatchlistsRepo;
  /** The symbol master: an added token must be a known instrument. */
  market: Pick<MarketDataAdapter, 'listInstruments'>;
  /** Id generator for new lists; default `wl_<uuid>`. */
  newId?: () => string;
};

export type WatchlistService = ReturnType<typeof createWatchlistService>;

const watchlistGone = () => new ApiHttpError(404, 'NOT_FOUND', WATCHLIST_MESSAGES.notFound);
const conflict = (message: string) => new ApiHttpError(409, 'CONFLICT', message);
const limitReached = (message: string) => new ApiHttpError(409, 'LIMIT_REACHED', message);

/** The public view of a stored list: UTC ISO timestamps, items in display order. */
export function toWatchlist(record: WatchlistRecord): Watchlist {
  return {
    id: record.id,
    name: record.name,
    items: record.items.map((item) => ({
      token: item.token,
      symbol: item.symbol,
      exchange: item.exchange,
      name: item.name,
      addedAt: item.addedAt.toISOString(),
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** True when `wanted` holds exactly the values of `current`, in any order (no more, no fewer). */
const samePermutation = <T>(current: readonly T[], wanted: readonly T[]) =>
  current.length === wanted.length && wanted.every((value) => current.includes(value));

/**
 * Watchlist rules (T-115), the same as the MSW handlers (T-116): every user starts with an empty
 * "My Watchlist" on their first watchlist call; at most 10 lists of 50 stocks; unique list names
 * (case-insensitive); a stock appears once per list; the last list cannot be deleted; a reorder
 * must name exactly the current lists or stocks (409 when the client's copy is stale).
 */
export function createWatchlistService({
  clock,
  repo,
  market,
  newId = () => `wl_${randomUUID().replaceAll('-', '')}`,
}: WatchlistServiceDeps) {
  let instruments: Promise<Map<number, Instrument>> | null = null;
  const instrumentByToken = async (token: number) => {
    instruments ??= market
      .listInstruments()
      .then((list) => new Map(list.map((instrument) => [instrument.token, instrument])));
    return (await instruments).get(token) ?? null;
  };

  const defaultList = (userId: string): WatchlistRecord => {
    const now = clock.now();
    return {
      id: newId(),
      userId,
      name: WATCHLIST_DEFAULT_NAME,
      items: [],
      createdAt: now,
      updatedAt: now,
    };
  };

  /** Runs `change` on the user's lists, creating the default list on first use. */
  const withLists = <T>(
    userId: string,
    change: (lists: WatchlistRecord[]) => { lists: WatchlistRecord[]; result: T },
  ) => repo.update(userId, (stored) => change(stored ?? [defaultList(userId)]));

  /** Changes one list in place and answers with its new view; 404 when it is not the user's. */
  const withList = (
    userId: string,
    id: string,
    change: (list: WatchlistRecord, lists: WatchlistRecord[]) => void,
  ) =>
    withLists(userId, (lists) => {
      const list = lists.find((l) => l.id === id);
      if (!list) throw watchlistGone();
      change(list, lists);
      list.updatedAt = clock.now();
      return { lists, result: toWatchlist(list) };
    });

  const assertNameFree = (lists: readonly WatchlistRecord[], name: string, exceptId?: string) => {
    if (lists.some((l) => l.id !== exceptId && sameWatchlistName(l.name, name))) {
      throw conflict(WATCHLIST_MESSAGES.duplicateName);
    }
  };

  return {
    list: (userId: string): Promise<Watchlist[]> =>
      withLists(userId, (lists) => ({ lists, result: lists.map(toWatchlist) })),

    create: (userId: string, name: string): Promise<Watchlist> =>
      withLists(userId, (lists) => {
        if (lists.length >= WATCHLIST_MAX_LISTS) throw limitReached(WATCHLIST_MESSAGES.listLimit);
        assertNameFree(lists, name);
        const now = clock.now();
        const list: WatchlistRecord = {
          id: newId(),
          userId,
          name,
          items: [],
          createdAt: now,
          updatedAt: now,
        };
        return { lists: [...lists, list], result: toWatchlist(list) };
      }),

    rename: (userId: string, id: string, name: string): Promise<Watchlist> =>
      withList(userId, id, (list, lists) => {
        assertNameFree(lists, name, id);
        list.name = name;
      }),

    remove: (userId: string, id: string): Promise<void> =>
      withLists(userId, (lists) => {
        if (!lists.some((l) => l.id === id)) throw watchlistGone();
        if (lists.length === 1) throw conflict(WATCHLIST_MESSAGES.lastList);
        return { lists: lists.filter((l) => l.id !== id), result: undefined };
      }),

    reorder: (userId: string, ids: readonly string[]): Promise<Watchlist[]> =>
      withLists(userId, (lists) => {
        const current = lists.map((l) => l.id);
        if (!samePermutation(current, ids)) throw conflict(WATCHLIST_MESSAGES.staleOrder);
        const ordered = ids.map((id) => lists.find((l) => l.id === id) as WatchlistRecord);
        return { lists: ordered, result: ordered.map(toWatchlist) };
      }),

    async addItem(userId: string, id: string, token: number): Promise<Watchlist> {
      const instrument = await instrumentByToken(token);
      return withList(userId, id, (list) => {
        // An unknown list answers 404 before an unknown stock, as in the MSW handlers.
        if (!instrument) throw new ApiHttpError(404, 'NOT_FOUND', WATCHLIST_MESSAGES.unknownStock);
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
          addedAt: clock.now(),
        });
      });
    },

    removeItem: (userId: string, id: string, token: number): Promise<Watchlist> =>
      withList(userId, id, (list) => {
        const index = list.items.findIndex((item) => item.token === token);
        if (index < 0) throw new ApiHttpError(404, 'NOT_FOUND', WATCHLIST_MESSAGES.itemNotInList);
        list.items.splice(index, 1);
      }),

    reorderItems: (userId: string, id: string, tokens: readonly number[]): Promise<Watchlist> =>
      withList(userId, id, (list) => {
        const current = list.items.map((item) => item.token);
        if (!samePermutation(current, tokens)) throw conflict(WATCHLIST_MESSAGES.staleOrder);
        list.items = tokens.map(
          (token) => list.items.find((item) => item.token === token) as (typeof list.items)[number],
        );
      }),
  };
}

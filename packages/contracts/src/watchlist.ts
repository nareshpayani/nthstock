import { z } from 'zod';
import { Exchange, Id, InstrumentToken, IsoUtc, TradingSymbol } from './primitives.js';

export const WATCHLIST_MAX_LISTS = 10;
export const WATCHLIST_MAX_ITEMS = 50;
export const WATCHLIST_NAME_MAX = 24;
/** The list every user starts with; the backends create it on the user's first watchlist call. */
export const WATCHLIST_DEFAULT_NAME = 'My Watchlist';

/**
 * Plain-language error messages. apps/api and the MSW handlers answer with exactly these, so the
 * UI can show `error.message` as is. Status and code per rule: `notFound`, `unknownStock` and
 * `itemNotInList` are 404 NOT_FOUND; `listLimit` and `itemLimit` are 409 LIMIT_REACHED; the rest
 * are 409 CONFLICT.
 */
export const WATCHLIST_MESSAGES = {
  notFound: 'This watchlist no longer exists. Refresh and try again.',
  listLimit: `You can have up to ${WATCHLIST_MAX_LISTS} watchlists. Delete one to create another.`,
  itemLimit: `A watchlist can hold up to ${WATCHLIST_MAX_ITEMS} stocks. Remove one to add another.`,
  duplicateName: 'You already have a watchlist with this name. Choose a different name.',
  duplicateItem: (symbol: string) => `${symbol} is already in this watchlist.`,
  unknownStock: 'This stock could not be found.',
  itemNotInList: 'This stock is not in the watchlist.',
  lastList: 'You need at least one watchlist, so this one cannot be deleted.',
  staleOrder: 'Your watchlist changed since it was loaded. Refresh and try again.',
} as const;

/** Names compare trimmed and case-insensitively, so "Banks" and " banks " clash. */
export const sameWatchlistName = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase('en-IN') === b.trim().toLocaleLowerCase('en-IN');

const uniqueValues = (values: readonly (string | number)[]) =>
  new Set(values).size === values.length;

export const WatchlistName = z
  .string()
  .trim()
  .min(1, { error: 'Enter a name' })
  .max(WATCHLIST_NAME_MAX, { error: `Name must be ${WATCHLIST_NAME_MAX} characters or fewer` });
export type WatchlistName = z.infer<typeof WatchlistName>;

export const WatchlistItem = z.object({
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  name: z.string().min(1).max(120),
  addedAt: IsoUtc,
});
export type WatchlistItem = z.infer<typeof WatchlistItem>;

export const Watchlist = z.object({
  id: Id,
  name: WatchlistName,
  items: z
    .array(WatchlistItem)
    .max(WATCHLIST_MAX_ITEMS, {
      error: `A watchlist can hold up to ${WATCHLIST_MAX_ITEMS} stocks`,
    })
    .refine((items) => uniqueValues(items.map((i) => i.token)), {
      error: 'A stock can appear only once in a watchlist',
    }),
  createdAt: IsoUtc,
  updatedAt: IsoUtc,
});
export type Watchlist = z.infer<typeof Watchlist>;

/** All of the user's watchlists, in display order. */
export const WatchlistsResponse = z.object({
  items: z.array(Watchlist).max(WATCHLIST_MAX_LISTS, {
    error: `You can have up to ${WATCHLIST_MAX_LISTS} watchlists`,
  }),
});
export type WatchlistsResponse = z.infer<typeof WatchlistsResponse>;

export const CreateWatchlistRequest = z.object({ name: WatchlistName });
export type CreateWatchlistRequest = z.infer<typeof CreateWatchlistRequest>;

export const RenameWatchlistRequest = z.object({ name: WatchlistName });
export type RenameWatchlistRequest = z.infer<typeof RenameWatchlistRequest>;

export const ReorderWatchlistsRequest = z.object({
  ids: z
    .array(Id)
    .min(1)
    .max(WATCHLIST_MAX_LISTS)
    .refine(uniqueValues, { error: 'Each watchlist must appear once' }),
});
export type ReorderWatchlistsRequest = z.infer<typeof ReorderWatchlistsRequest>;

export const AddWatchlistItemRequest = z.object({ token: InstrumentToken });
export type AddWatchlistItemRequest = z.infer<typeof AddWatchlistItemRequest>;

export const ReorderWatchlistItemsRequest = z.object({
  tokens: z
    .array(InstrumentToken)
    .min(1)
    .max(WATCHLIST_MAX_ITEMS)
    .refine(uniqueValues, { error: 'Each stock must appear once' }),
});
export type ReorderWatchlistItemsRequest = z.infer<typeof ReorderWatchlistItemsRequest>;

export const WatchlistParams = z.object({ id: Id });
export type WatchlistParams = z.infer<typeof WatchlistParams>;

/** Path params for removing an item; `token` arrives as a string and is coerced. */
export const WatchlistItemParams = z.object({
  id: Id,
  token: z.coerce.number().pipe(InstrumentToken),
});
export type WatchlistItemParams = z.infer<typeof WatchlistItemParams>;

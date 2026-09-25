import { z } from 'zod';
import { Exchange, Id, InstrumentToken, IsoUtc, TradingSymbol } from './primitives.js';

export const WATCHLIST_MAX_LISTS = 10;
export const WATCHLIST_MAX_ITEMS = 50;
export const WATCHLIST_NAME_MAX = 30;

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

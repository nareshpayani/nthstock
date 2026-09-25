import { z } from 'zod';
import {
  OtpRequest,
  OtpRequestResponse,
  OtpVerifyRequest,
  PinSetRequest,
  PinSetResponse,
  PinVerifyRequest,
  Session,
} from './auth.js';
import {
  BatchQuotesQuery,
  BatchQuotesResponse,
  CandleSeries,
  CandlesQuery,
  Depth,
  ExchangeQuery,
  IndicesResponse,
  Instrument,
  InstrumentStats,
  Movers,
  MoversQuery,
  SearchQuery,
  SearchResponse,
  StockList,
  StockListParams,
  StockListsResponse,
  SymbolParams,
} from './market.js';
import {
  ModifyOrderRequest,
  Order,
  OrderParams,
  OrdersPage,
  OrdersQuery,
  PlaceOrderRequest,
} from './orders.js';
import {
  FundsSummary,
  HoldingsResponse,
  LedgerPage,
  PortfolioSummary,
  PositionsResponse,
  ResetRequest,
} from './portfolio.js';
import { CursorQuery, IsoUtc, OkResponse } from './primitives.js';
import {
  AddWatchlistItemRequest,
  CreateWatchlistRequest,
  RenameWatchlistRequest,
  ReorderWatchlistItemsRequest,
  ReorderWatchlistsRequest,
  Watchlist,
  WatchlistItemParams,
  WatchlistParams,
  WatchlistsResponse,
} from './watchlist.js';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  time: IsoUtc,
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** `public` routes need no session; `user` routes need a valid access token. */
export type RouteAuth = 'public' | 'user';

/** One REST endpoint. Every route must declare a response schema. */
export interface RouteDef {
  readonly method: HttpMethod;
  /** Express-style path under `/v1`, e.g. `/v1/watchlists/:id`. */
  readonly path: `/v1/${string}`;
  readonly auth: RouteAuth;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  readonly response: z.ZodType;
}

/**
 * The REST route map: the single source for MSW handlers, Fastify routes and the API client.
 * Errors on every route use the ApiError envelope.
 */
export const routes = {
  // Health
  health: { method: 'GET', path: '/v1/health', auth: 'public', response: HealthResponse },

  // Auth
  otpRequest: {
    method: 'POST',
    path: '/v1/auth/otp/request',
    auth: 'public',
    body: OtpRequest,
    response: OtpRequestResponse,
  },
  otpVerify: {
    method: 'POST',
    path: '/v1/auth/otp/verify',
    auth: 'public',
    body: OtpVerifyRequest,
    response: Session,
  },
  pinSet: {
    method: 'POST',
    path: '/v1/auth/pin/set',
    auth: 'user',
    body: PinSetRequest,
    response: PinSetResponse,
  },
  pinVerify: {
    method: 'POST',
    path: '/v1/auth/pin/verify',
    auth: 'public',
    body: PinVerifyRequest,
    response: Session,
  },
  sessionGet: { method: 'GET', path: '/v1/auth/session', auth: 'user', response: Session },
  sessionRefresh: { method: 'POST', path: '/v1/auth/refresh', auth: 'public', response: Session },
  logout: { method: 'POST', path: '/v1/auth/logout', auth: 'user', response: OkResponse },

  // Market
  marketIndices: {
    method: 'GET',
    path: '/v1/market/indices',
    auth: 'public',
    response: IndicesResponse,
  },
  marketLists: {
    method: 'GET',
    path: '/v1/market/lists',
    auth: 'public',
    response: StockListsResponse,
  },
  marketList: {
    method: 'GET',
    path: '/v1/market/lists/:id',
    auth: 'public',
    params: StockListParams,
    response: StockList,
  },
  marketMovers: {
    method: 'GET',
    path: '/v1/market/movers',
    auth: 'public',
    query: MoversQuery,
    response: Movers,
  },
  marketQuotes: {
    method: 'GET',
    path: '/v1/market/quotes',
    auth: 'public',
    query: BatchQuotesQuery,
    response: BatchQuotesResponse,
  },
  marketSearch: {
    method: 'GET',
    path: '/v1/market/search',
    auth: 'public',
    query: SearchQuery,
    response: SearchResponse,
  },
  instrument: {
    method: 'GET',
    path: '/v1/market/instruments/:symbol',
    auth: 'public',
    params: SymbolParams,
    query: ExchangeQuery,
    response: Instrument,
  },
  instrumentCandles: {
    method: 'GET',
    path: '/v1/market/instruments/:symbol/candles',
    auth: 'public',
    params: SymbolParams,
    query: CandlesQuery,
    response: CandleSeries,
  },
  instrumentDepth: {
    method: 'GET',
    path: '/v1/market/instruments/:symbol/depth',
    auth: 'public',
    params: SymbolParams,
    query: ExchangeQuery,
    response: Depth,
  },
  instrumentStats: {
    method: 'GET',
    path: '/v1/market/instruments/:symbol/stats',
    auth: 'public',
    params: SymbolParams,
    query: ExchangeQuery,
    response: InstrumentStats,
  },

  // Watchlists
  watchlistsList: {
    method: 'GET',
    path: '/v1/watchlists',
    auth: 'user',
    response: WatchlistsResponse,
  },
  watchlistCreate: {
    method: 'POST',
    path: '/v1/watchlists',
    auth: 'user',
    body: CreateWatchlistRequest,
    response: Watchlist,
  },
  watchlistsReorder: {
    method: 'PUT',
    path: '/v1/watchlists/order',
    auth: 'user',
    body: ReorderWatchlistsRequest,
    response: WatchlistsResponse,
  },
  watchlistRename: {
    method: 'PATCH',
    path: '/v1/watchlists/:id',
    auth: 'user',
    params: WatchlistParams,
    body: RenameWatchlistRequest,
    response: Watchlist,
  },
  watchlistDelete: {
    method: 'DELETE',
    path: '/v1/watchlists/:id',
    auth: 'user',
    params: WatchlistParams,
    response: OkResponse,
  },
  watchlistItemAdd: {
    method: 'POST',
    path: '/v1/watchlists/:id/items',
    auth: 'user',
    params: WatchlistParams,
    body: AddWatchlistItemRequest,
    response: Watchlist,
  },
  watchlistItemRemove: {
    method: 'DELETE',
    path: '/v1/watchlists/:id/items/:token',
    auth: 'user',
    params: WatchlistItemParams,
    response: Watchlist,
  },
  watchlistItemsReorder: {
    method: 'PUT',
    path: '/v1/watchlists/:id/items/order',
    auth: 'user',
    params: WatchlistParams,
    body: ReorderWatchlistItemsRequest,
    response: Watchlist,
  },

  // Orders
  ordersList: {
    method: 'GET',
    path: '/v1/orders',
    auth: 'user',
    query: OrdersQuery,
    response: OrdersPage,
  },
  orderGet: {
    method: 'GET',
    path: '/v1/orders/:id',
    auth: 'user',
    params: OrderParams,
    response: Order,
  },
  orderPlace: {
    method: 'POST',
    path: '/v1/orders',
    auth: 'user',
    body: PlaceOrderRequest,
    response: Order,
  },
  orderModify: {
    method: 'PATCH',
    path: '/v1/orders/:id',
    auth: 'user',
    params: OrderParams,
    body: ModifyOrderRequest,
    response: Order,
  },
  orderCancel: {
    method: 'DELETE',
    path: '/v1/orders/:id',
    auth: 'user',
    params: OrderParams,
    response: Order,
  },

  // Portfolio and funds
  positionsList: {
    method: 'GET',
    path: '/v1/positions',
    auth: 'user',
    response: PositionsResponse,
  },
  holdingsList: { method: 'GET', path: '/v1/holdings', auth: 'user', response: HoldingsResponse },
  portfolioSummary: {
    method: 'GET',
    path: '/v1/portfolio/summary',
    auth: 'user',
    response: PortfolioSummary,
  },
  fundsSummary: { method: 'GET', path: '/v1/funds', auth: 'user', response: FundsSummary },
  fundsLedger: {
    method: 'GET',
    path: '/v1/funds/ledger',
    auth: 'user',
    query: CursorQuery,
    response: LedgerPage,
  },
  fundsReset: {
    method: 'POST',
    path: '/v1/funds/reset',
    auth: 'user',
    body: ResetRequest,
    response: FundsSummary,
  },
} as const satisfies Record<string, RouteDef>;

export type Routes = typeof routes;
export type RouteName = keyof Routes;

type SchemaOf<R, K extends 'params' | 'query' | 'body'> = R extends { [P in K]: infer S }
  ? S extends z.ZodType
    ? S
    : never
  : never;

/** Parsed response data for a route. */
export type RouteResponse<N extends RouteName> = z.output<Routes[N]['response']>;
/** What the client sends as the body (`never` when the route has none). */
export type RouteBody<N extends RouteName> = z.input<SchemaOf<Routes[N], 'body'>>;
/** Path params as strings in the URL, before coercion. */
export type RouteParams<N extends RouteName> = z.input<SchemaOf<Routes[N], 'params'>>;
/** Query string values before coercion. */
export type RouteQuery<N extends RouteName> = z.input<SchemaOf<Routes[N], 'query'>>;

/** Names of `:param` segments in a path, e.g. `'id' | 'token'`. */
export type PathParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | PathParamNames<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

/** Fills a route path with params, URL-encoding each value. */
export const buildPath = (path: string, params: Readonly<Record<string, string | number>> = {}) =>
  path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing path param "${name}" for ${path}`);
    }
    return encodeURIComponent(String(value));
  });

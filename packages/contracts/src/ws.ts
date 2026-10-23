import { z } from 'zod';
import {
  Exchange,
  InstrumentToken,
  IsoUtc,
  NonNegativePaise,
  Seq,
  TradingSymbol,
} from './primitives.js';
import { Depth, Quote } from './market.js';
import { Order } from './orders.js';
import { FundsSummary, Position } from './portfolio.js';
import { TrailingStop } from './trailingStops.js';

/** Current WebSocket protocol version, carried as `v` on every message. */
export const WS_PROTOCOL_VERSION = 1;

/** Maximum symbols one connection may subscribe to. */
export const WS_MAX_SUBSCRIPTIONS = 200;

/** The server closes a connection it has heard nothing from (no message, no pong) for this long. */
export const WS_IDLE_TIMEOUT_MS = 60_000;

/** Close codes the server uses (4000–4999 is the application range). */
export const WS_CLOSE_CODES = {
  /**
   * The upgrade carried no valid access token (the `nth_at` cookie): missing, expired, forged.
   * The client refreshes its session once, then reconnects; it does not retry blindly.
   */
  unauthorized: 4401,
  /** Idle for `WS_IDLE_TIMEOUT_MS`. The client reconnects as for any drop. */
  idleTimeout: 4408,
} as const;

const v = z.literal(WS_PROTOCOL_VERSION);

const SymbolSet = z.array(TradingSymbol).min(1).max(WS_MAX_SUBSCRIPTIONS);

export const WsSubscribe = z.object({
  v,
  type: z.literal('subscribe'),
  symbols: SymbolSet,
  exchange: Exchange.default('NSE'),
});
export type WsSubscribe = z.infer<typeof WsSubscribe>;

export const WsUnsubscribe = z.object({
  v,
  type: z.literal('unsubscribe'),
  symbols: SymbolSet,
  exchange: Exchange.default('NSE'),
});
export type WsUnsubscribe = z.infer<typeof WsUnsubscribe>;

/** Heartbeat; the server echoes `id` in its pong. */
export const WsPing = z.object({
  v,
  type: z.literal('ping'),
  id: z.number().int().min(0),
});
export type WsPing = z.infer<typeof WsPing>;

/**
 * Switches the connection to `accountDelta` frames (ADR 0012) and names the instrument the user
 * is looking at: each frame then carries its depth, and the mock market ticks it every 250 ms
 * (SPEC-TFC-1 TFC-11). Send it again when the instrument changes; `symbol: null` keeps the frames
 * without depth. A connection that never sends it keeps `quotes` and `orderUpdate` messages.
 */
export const WsFocus = z.object({
  v,
  type: z.literal('focus'),
  symbol: TradingSymbol.nullable(),
  exchange: Exchange.default('NSE'),
});
export type WsFocus = z.infer<typeof WsFocus>;

/** Messages the client sends. */
export const WsClientMessage = z.discriminatedUnion('type', [
  WsSubscribe,
  WsUnsubscribe,
  WsPing,
  WsFocus,
]);
export type WsClientMessage = z.infer<typeof WsClientMessage>;

/**
 * The per-instrument part of a quote that changes at most once a session: what a binary quote
 * frame's token stands for, plus the open and previous close the frame leaves out (T-074). The
 * server sends it, as an `instruments` message, before the first binary frame that needs it and
 * again whenever it changes.
 */
export const WsInstrument = z.object({
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  open: NonNegativePaise,
  prevClose: NonNegativePaise,
});
export type WsInstrument = z.infer<typeof WsInstrument>;

export const WsInstruments = z.object({
  v,
  type: z.literal('instruments'),
  instruments: z.array(WsInstrument).min(1).max(WS_MAX_SUBSCRIPTIONS),
});
export type WsInstruments = z.infer<typeof WsInstruments>;

/**
 * A conflated batch of quotes (at most 4 updates/sec/symbol) as JSON. apps/realtime sends quotes
 * as binary frames instead (`quoteFrame.ts`) and falls back to this; the MSW mock sends this.
 */
export const WsQuotes = z.object({
  v,
  type: z.literal('quotes'),
  quotes: z.array(Quote).min(1),
});
export type WsQuotes = z.infer<typeof WsQuotes>;

export const WsOrderUpdate = z.object({
  v,
  type: z.literal('orderUpdate'),
  order: Order,
});
export type WsOrderUpdate = z.infer<typeof WsOrderUpdate>;

/**
 * One flush of the paper engine (ADR 0012, SPEC-TFC-1 §10.1): every 250 ms, the quotes of the
 * subscribed symbols, the focused instrument's depth, and every order, position and trailing stop
 * those ticks changed, with the funds when they changed, all at engine `seq`. The client applies a
 * frame in one commit, so no surface shows a fill another has not seen. Entities are upserts keyed
 * by id (orders, trailing stops) or by instrument and product (positions); nothing is removed.
 */
export const WsAccountDelta = z.object({
  v,
  type: z.literal('accountDelta'),
  seq: Seq,
  /** When the engine produced the frame. */
  at: IsoUtc,
  quotes: z.array(Quote),
  /** Depth of the instrument the client is focused on, when it has one. */
  depth: Depth.optional(),
  orders: z.array(Order),
  positions: z.array(Position),
  trailingStops: z.array(TrailingStop),
  /** Present when a fill, block or release changed the funds. */
  funds: FundsSummary.optional(),
});
export type WsAccountDelta = z.infer<typeof WsAccountDelta>;

export const WsPong = z.object({
  v,
  type: z.literal('pong'),
  id: z.number().int().min(0),
});
export type WsPong = z.infer<typeof WsPong>;

export const WsErrorCode = z.enum([
  'INVALID_MESSAGE',
  'UNSUPPORTED_VERSION',
  'SUBSCRIPTION_LIMIT',
  'UNKNOWN_SYMBOL',
  'UNAUTHORIZED',
  'INTERNAL_ERROR',
]);
export type WsErrorCode = z.infer<typeof WsErrorCode>;

export const WsError = z.object({
  v,
  type: z.literal('error'),
  code: WsErrorCode,
  message: z.string().min(1),
  /** Symbols the error applies to, e.g. those refused by the subscription limit. */
  symbols: z.array(TradingSymbol).optional(),
});
export type WsError = z.infer<typeof WsError>;

/** Messages the server sends. */
export const WsServerMessage = z.discriminatedUnion('type', [
  WsQuotes,
  WsInstruments,
  WsOrderUpdate,
  WsAccountDelta,
  WsPong,
  WsError,
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;

export type WsMessageType = WsClientMessage['type'] | WsServerMessage['type'];

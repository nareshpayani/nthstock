import { z } from 'zod';
import { Exchange, TradingSymbol } from './primitives.js';
import { Quote } from './market.js';
import { Order } from './orders.js';

/** Current WebSocket protocol version, carried as `v` on every message. */
export const WS_PROTOCOL_VERSION = 1;

/** Maximum symbols one connection may subscribe to. */
export const WS_MAX_SUBSCRIPTIONS = 200;

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

/** Messages the client sends. */
export const WsClientMessage = z.discriminatedUnion('type', [WsSubscribe, WsUnsubscribe, WsPing]);
export type WsClientMessage = z.infer<typeof WsClientMessage>;

/** A conflated batch of quotes (at most 4 updates/sec/symbol). */
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
  WsOrderUpdate,
  WsPong,
  WsError,
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;

export type WsMessageType = WsClientMessage['type'] | WsServerMessage['type'];

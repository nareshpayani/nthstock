import { z } from 'zod';
import {
  Count,
  CursorQuery,
  Exchange,
  Id,
  InstrumentToken,
  IsoUtc,
  Paise,
  Seq,
  TickPrice,
  TradingSymbol,
  cursorPage,
} from './primitives.js';
import { TrailingStopParams } from './trailingStopParams.js';

export const OrderSide = z.enum(['BUY', 'SELL']);
export type OrderSide = z.infer<typeof OrderSide>;

export const OrderType = z.enum(['MARKET', 'LIMIT']);
export type OrderType = z.infer<typeof OrderType>;

export const ProductType = z.enum(['DELIVERY', 'INTRADAY']);
export type ProductType = z.infer<typeof ProductType>;

/**
 * How long an order works. `DAY` works until it fills, is cancelled or the session ends. `IOC`
 * (immediate or cancel) fills what it can on the tick it arrives and cancels the rest; the
 * scalper sends IOC orders (SPEC-TFC-1 §11.2).
 */
export const OrderValidity = z.enum(['DAY', 'IOC']);
export type OrderValidity = z.infer<typeof OrderValidity>;

/**
 * AMO → OPEN → EXECUTED | CANCELLED; REJECTED on validation failure. A partly filled order stays
 * OPEN with `filledQty` below `qty` (SPEC-TFC-1 §10.3).
 */
export const OrderStatus = z.enum(['AMO', 'OPEN', 'EXECUTED', 'CANCELLED', 'REJECTED']);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** Order quantity: a whole number of shares, at least 1. */
export const OrderQty = z
  .number({ error: 'Enter a quantity' })
  .int({ error: 'Quantity must be a whole number' })
  .min(1, { error: 'Quantity must be at least 1' });
export type OrderQty = z.infer<typeof OrderQty>;

type PriceFields = { type?: OrderType | undefined; price?: number | undefined };

/** LIMIT needs a price; MARKET must not carry one. */
const checkPriceForType = (value: PriceFields, ctx: z.RefinementCtx) => {
  if (value.type === 'LIMIT' && value.price === undefined) {
    ctx.addIssue({ code: 'custom', path: ['price'], message: 'Enter a limit price' });
  }
  if (value.type === 'MARKET' && value.price !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['price'], message: 'A market order has no price' });
  }
};

export const PlaceOrderRequest = z
  .object({
    token: InstrumentToken,
    side: OrderSide,
    type: OrderType,
    product: ProductType,
    qty: OrderQty,
    /** Limit price in paise on the 5-paise tick. Required for LIMIT, absent for MARKET. */
    price: TickPrice.optional(),
    /** Client-generated idempotency key, so a retried place does not create a second order. */
    clientOrderId: Id.optional(),
    /** `DAY` when left out. */
    validity: OrderValidity.optional(),
    /**
     * A trailing stop that protects the position this entry opens or adds to (SPEC-TFC-1 §6.4).
     * It waits for the entry's first fill, then trails from that fill price.
     */
    attachedTrailingStop: TrailingStopParams.optional(),
  })
  .superRefine(checkPriceForType);
export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequest>;

/** Change qty, type or price of an AMO or OPEN order. At least one field is required. */
export const ModifyOrderRequest = z
  .object({
    qty: OrderQty.optional(),
    type: OrderType.optional(),
    price: TickPrice.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.qty === undefined && value.type === undefined && value.price === undefined) {
      ctx.addIssue({ code: 'custom', path: [], message: 'Nothing to change' });
    }
    checkPriceForType(value, ctx);
  });
export type ModifyOrderRequest = z.infer<typeof ModifyOrderRequest>;

/** Path params for get, modify and cancel. Cancel has no body. */
export const OrderParams = z.object({ id: Id });
export type OrderParams = z.infer<typeof OrderParams>;

export const Order = z.object({
  id: Id,
  clientOrderId: Id.nullable(),
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  side: OrderSide,
  type: OrderType,
  product: ProductType,
  qty: OrderQty,
  /** Limit price; null for MARKET. */
  price: TickPrice.nullable(),
  filledQty: Count,
  /**
   * Volume-weighted average of the fills so far, rounded to the paisa. Off the tick once fills at
   * different prices are averaged (SPEC-TFC-1 §10.3).
   */
  avgFillPrice: Paise.positive().nullable(),
  status: OrderStatus,
  /** Plain-language reason when REJECTED. */
  statusReason: z.string().max(200).nullable(),
  /** Orders saved before validity existed were all `DAY`, so restoring one fills it in. */
  validity: OrderValidity.default('DAY'),
  /**
   * The engine sequence number of this order's latest change. The paper engine sets it; apps/api
   * leaves it out until it adopts account frames (ADR 0012).
   */
  seq: Seq.optional(),
  placedAt: IsoUtc,
  updatedAt: IsoUtc,
});
export type Order = z.infer<typeof Order>;

export const OrdersQuery = CursorQuery.extend({ status: OrderStatus.optional() });
export type OrdersQuery = z.infer<typeof OrdersQuery>;

export const OrdersPage = cursorPage(Order);
export type OrdersPage = z.infer<typeof OrdersPage>;

/**
 * What happened to an order, one entry per change (T-146): placed (as OPEN, AMO or REJECTED),
 * modified, released at 9:15 (AMO → OPEN), partly executed (some of the quantity filled, the order
 * stays OPEN), executed, cancelled, or rejected when an AMO fails its check at release.
 */
export const OrderHistoryEvent = z.enum([
  'PLACED',
  'MODIFIED',
  'RELEASED',
  'PARTIALLY_EXECUTED',
  'EXECUTED',
  'CANCELLED',
  'REJECTED',
]);
export type OrderHistoryEvent = z.infer<typeof OrderHistoryEvent>;

/** One change of an order: the event, the status after it, when (UTC), and the terms after it. */
export const OrderHistoryEntry = z.object({
  event: OrderHistoryEvent,
  status: OrderStatus,
  at: IsoUtc,
  qty: OrderQty,
  type: OrderType,
  /** Limit price after the event; null for MARKET. */
  price: TickPrice.nullable(),
  /** The fill price, on PARTIALLY_EXECUTED and EXECUTED only. */
  fillPrice: TickPrice.nullable(),
  /**
   * Shares filled by this event, on PARTIALLY_EXECUTED and EXECUTED. History recorded before
   * partial fills has none: such an EXECUTED entry filled the whole quantity.
   */
  fillQty: OrderQty.nullable().optional(),
  /** Plain-language reason for a cancel or rejection. */
  note: z.string().max(200).nullable(),
});
export type OrderHistoryEntry = z.infer<typeof OrderHistoryEntry>;

/** `GET /v1/orders/:id/history`: the order's changes, oldest first. */
export const OrderHistoryResponse = z.object({
  orderId: Id,
  items: z.array(OrderHistoryEntry).min(1),
});
export type OrderHistoryResponse = z.infer<typeof OrderHistoryResponse>;

import { z } from 'zod';
import {
  Count,
  CursorQuery,
  Exchange,
  Id,
  InstrumentToken,
  IsoUtc,
  TickPrice,
  TradingSymbol,
  cursorPage,
} from './primitives.js';

export const OrderSide = z.enum(['BUY', 'SELL']);
export type OrderSide = z.infer<typeof OrderSide>;

export const OrderType = z.enum(['MARKET', 'LIMIT']);
export type OrderType = z.infer<typeof OrderType>;

export const ProductType = z.enum(['DELIVERY', 'INTRADAY']);
export type ProductType = z.infer<typeof ProductType>;

/** AMO → OPEN → EXECUTED | CANCELLED; REJECTED on validation failure. */
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
  avgFillPrice: TickPrice.nullable(),
  status: OrderStatus,
  /** Plain-language reason when REJECTED. */
  statusReason: z.string().max(200).nullable(),
  placedAt: IsoUtc,
  updatedAt: IsoUtc,
});
export type Order = z.infer<typeof Order>;

export const OrdersQuery = CursorQuery.extend({ status: OrderStatus.optional() });
export type OrdersQuery = z.infer<typeof OrdersQuery>;

export const OrdersPage = cursorPage(Order);
export type OrdersPage = z.infer<typeof OrdersPage>;

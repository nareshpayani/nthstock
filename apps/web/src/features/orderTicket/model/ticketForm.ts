import {
  ModifyOrderRequest,
  OrderQty,
  OrderSide,
  OrderType,
  PlaceOrderRequest,
  ProductType,
  TickPrice,
  type InstrumentToken,
  type Order,
} from '@nthstock/contracts';
import { z } from 'zod';
import { strings } from '../strings';

/**
 * The ticket form (T-136), built from the contract schemas in packages/contracts so the ticket
 * and the API agree on every rule: quantity is `OrderQty`, a limit price is `TickPrice` (positive
 * paise on the 5-paise tick). `qty` and `price` may be null while the inputs are empty or hold
 * something that is not a number. A market order keeps the prefilled price in the form but never
 * sends it, so the price is only checked for a limit order.
 */
export const TicketFormSchema = z
  .object({
    side: OrderSide,
    type: OrderType,
    product: ProductType,
    qty: z.number().nullable(),
    price: z.number().nullable(),
  })
  .superRefine((value, ctx) => {
    const qty = OrderQty.safeParse(value.qty ?? undefined);
    if (!qty.success) {
      ctx.addIssue({ code: 'custom', path: ['qty'], message: firstMessage(qty.error) });
    }
    if (value.type !== 'LIMIT') return;
    if (value.price === null) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: strings.form.limitPriceRequired });
      return;
    }
    const price = TickPrice.safeParse(value.price);
    if (!price.success) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: firstMessage(price.error) });
    }
  });

export type TicketFormValues = z.infer<typeof TicketFormSchema>;

function firstMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid value';
}

/**
 * A fresh ticket: the side the user asked for, a market order, for one delivery share unless the
 * intent prefills the quantity and product (Exit on a position, T-150).
 */
export function defaultTicketValues(
  side: OrderSide,
  prefill: { qty?: number | undefined; product?: ProductType | undefined } = {},
): TicketFormValues {
  return {
    side,
    type: 'MARKET',
    product: prefill.product ?? 'DELIVERY',
    qty: prefill.qty ?? 1,
    price: null,
  };
}

/**
 * The `POST /v1/orders` body for valid form values, parsed with the contract's
 * `PlaceOrderRequest` (throws when the values were not validated first).
 */
export function toPlaceOrderRequest(
  values: TicketFormValues,
  token: InstrumentToken,
  clientOrderId: string,
): PlaceOrderRequest {
  return PlaceOrderRequest.parse({
    token,
    side: values.side,
    type: values.type,
    product: values.product,
    qty: values.qty,
    ...(values.type === 'LIMIT' ? { price: values.price } : {}),
    clientOrderId,
  });
}

/**
 * What the order is worth in paise: qty × limit price, or qty × LTP for a market order. `null`
 * when a part is missing or the product is not a safe integer.
 */
export function orderValue(
  values: Pick<TicketFormValues, 'type' | 'qty' | 'price'>,
  ltp: number | null | undefined,
): number | null {
  const price = values.type === 'LIMIT' ? values.price : (ltp ?? null);
  if (values.qty === null || price === null || values.qty < 1 || price <= 0) return null;
  const value = values.qty * price;
  return Number.isSafeInteger(value) ? value : null;
}

/** A per-order idempotency key (`Id`): a retried place of the same order is not doubled. */
export function newClientOrderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `tkt_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The ticket for modifying an open order (T-145): its own side, type, product, qty and price. */
export function ticketValuesFromOrder(order: Order): TicketFormValues {
  return {
    side: order.side,
    type: order.type,
    product: order.product,
    qty: order.qty,
    price: order.price,
  };
}

/**
 * The `PATCH /v1/orders/:id` body for valid form values: only quantity and price, and only what
 * changed (the price only for a limit order). `null` when nothing changed.
 */
export function toModifyRequest(values: TicketFormValues, order: Order): ModifyOrderRequest | null {
  const body: { qty?: number; price?: number } = {};
  if (values.qty !== null && values.qty !== order.qty) body.qty = values.qty;
  if (order.type === 'LIMIT' && values.price !== null && values.price !== order.price) {
    body.price = values.price;
  }
  if (body.qty === undefined && body.price === undefined) return null;
  return ModifyOrderRequest.parse(body);
}

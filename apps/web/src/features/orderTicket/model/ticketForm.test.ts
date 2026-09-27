import { Id } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  TicketFormSchema,
  defaultTicketValues,
  newClientOrderId,
  orderValue,
  ticketValuesFromOrder,
  toModifyRequest,
  toPlaceOrderRequest,
  type TicketFormValues,
} from './ticketForm';
import { testOrder } from '@/test/orders';

const base: TicketFormValues = defaultTicketValues('BUY');

/** The first message on each path, for the matrix. */
function errors(values: Partial<TicketFormValues>): Record<string, string> {
  const result = TicketFormSchema.safeParse({ ...base, ...values });
  if (result.success) return {};
  const out: Record<string, string> = {};
  for (const issue of result.error.issues) out[issue.path.join('.')] ??= issue.message;
  return out;
}

describe('ticket form schema (T-136) validation matrix', () => {
  it.each([
    [{ qty: 1 }, {}],
    [{ qty: 250 }, {}],
    [{ qty: null }, { qty: 'Enter a quantity' }],
    [{ qty: 0 }, { qty: 'Quantity must be at least 1' }],
    [{ qty: -3 }, { qty: 'Quantity must be at least 1' }],
    [{ qty: 1.5 }, { qty: 'Quantity must be a whole number' }],
  ])('qty %j → %j', (values, expected) => {
    expect(errors(values)).toEqual(expected);
  });

  it.each([
    // A market order never checks the (prefilled) price.
    [{ type: 'MARKET', price: null }, {}],
    [{ type: 'MARKET', price: 150003 }, {}],
    [{ type: 'LIMIT', price: 151235 }, {}],
    [{ type: 'LIMIT', price: null }, { price: 'Enter a limit price' }],
    [{ type: 'LIMIT', price: 150003 }, { price: 'Price must be a multiple of 5 paise' }],
    [{ type: 'LIMIT', price: 0 }, { price: expect.any(String) as string }],
    [{ type: 'LIMIT', price: -5 }, { price: expect.any(String) as string }],
  ] as const)('price %j → %j', (values, expected) => {
    expect(errors(values)).toEqual(expected);
  });

  it('reports qty and price together', () => {
    expect(errors({ qty: 0, type: 'LIMIT', price: 150003 })).toEqual({
      qty: 'Quantity must be at least 1',
      price: 'Price must be a multiple of 5 paise',
    });
  });

  it('starts as a delivery market order for one share on the requested side', () => {
    expect(defaultTicketValues('SELL')).toEqual({
      side: 'SELL',
      type: 'MARKET',
      product: 'DELIVERY',
      qty: 1,
      price: null,
    });
  });

  it('prefills quantity and product from the intent (Exit on a position, T-150)', () => {
    expect(defaultTicketValues('SELL', { qty: 10, product: 'INTRADAY' })).toEqual({
      side: 'SELL',
      type: 'MARKET',
      product: 'INTRADAY',
      qty: 10,
      price: null,
    });
  });
});

describe('toPlaceOrderRequest', () => {
  it('drops the price of a market order and keeps a limit price', () => {
    expect(toPlaceOrderRequest({ ...base, qty: 10, price: 151235 }, 501, 'tkt_1')).toEqual({
      token: 501,
      side: 'BUY',
      type: 'MARKET',
      product: 'DELIVERY',
      qty: 10,
      clientOrderId: 'tkt_1',
    });
    expect(
      toPlaceOrderRequest(
        { ...base, side: 'SELL', type: 'LIMIT', product: 'INTRADAY', qty: 2, price: 151235 },
        501,
        'tkt_2',
      ),
    ).toEqual({
      token: 501,
      side: 'SELL',
      type: 'LIMIT',
      product: 'INTRADAY',
      qty: 2,
      price: 151235,
      clientOrderId: 'tkt_2',
    });
  });

  it('throws on values that were not validated', () => {
    expect(() => toPlaceOrderRequest({ ...base, qty: 0 }, 501, 'tkt_3')).toThrow();
  });
});

describe('orderValue', () => {
  it('values a limit order at its price and a market order at the LTP, in paise', () => {
    expect(orderValue({ type: 'LIMIT', qty: 10, price: 151235 }, 999)).toBe(1_512_350);
    expect(orderValue({ type: 'MARKET', qty: 3, price: 151235 }, 150000)).toBe(450_000);
  });

  it('is null when a part is missing or the value is not a safe integer', () => {
    expect(orderValue({ type: 'MARKET', qty: 3, price: null }, undefined)).toBeNull();
    expect(orderValue({ type: 'LIMIT', qty: null, price: 100 }, 100)).toBeNull();
    expect(orderValue({ type: 'LIMIT', qty: 0, price: 100 }, 100)).toBeNull();
    expect(orderValue({ type: 'LIMIT', qty: 2, price: Number.MAX_SAFE_INTEGER }, null)).toBeNull();
  });
});

describe('newClientOrderId', () => {
  it('is a contract Id and differs each time', () => {
    const a = newClientOrderId();
    expect(Id.safeParse(a).success).toBe(true);
    expect(newClientOrderId()).not.toBe(a);
  });
});

describe('modify mode (T-145)', () => {
  const open = testOrder({
    side: 'SELL',
    type: 'LIMIT',
    product: 'INTRADAY',
    qty: 4,
    price: 150_000,
  });

  it('starts from the order: its side, type, product, qty and price', () => {
    expect(ticketValuesFromOrder(open)).toEqual({
      side: 'SELL',
      type: 'LIMIT',
      product: 'INTRADAY',
      qty: 4,
      price: 150_000,
    });
  });

  it('sends only the quantity and price that changed, or nothing', () => {
    const values = ticketValuesFromOrder(open);
    expect(toModifyRequest(values, open)).toBeNull();
    expect(toModifyRequest({ ...values, qty: 6 }, open)).toEqual({ qty: 6 });
    expect(toModifyRequest({ ...values, price: 149_500 }, open)).toEqual({ price: 149_500 });
    expect(toModifyRequest({ ...values, qty: 5, price: 149_000 }, open)).toEqual({
      qty: 5,
      price: 149_000,
    });
    // A market order has no price to change.
    const market = testOrder({ type: 'MARKET', price: null, qty: 2 });
    expect(
      toModifyRequest({ ...ticketValuesFromOrder(market), price: 150_000 }, market),
    ).toBeNull();
  });
});

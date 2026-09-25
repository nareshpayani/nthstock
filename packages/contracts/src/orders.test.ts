import { describe, expect, it } from 'vitest';
import {
  modifyOrderFixture,
  orderFixture,
  placeLimitFixture,
  placeMarketFixture,
} from './fixtures.js';
import {
  ModifyOrderRequest,
  Order,
  OrderStatus,
  OrderType,
  OrdersPage,
  OrdersQuery,
  PlaceOrderRequest,
  ProductType,
} from './orders.js';

const messages = (result: { error?: { issues: { message: string }[] } | undefined }) =>
  result.error?.issues.map((i) => i.message) ?? [];

describe('order fixtures round-trip', () => {
  it.each([
    ['PlaceOrderRequest (LIMIT)', PlaceOrderRequest, placeLimitFixture],
    ['PlaceOrderRequest (MARKET)', PlaceOrderRequest, placeMarketFixture],
    ['ModifyOrderRequest', ModifyOrderRequest, modifyOrderFixture],
    ['Order', Order, orderFixture],
    ['OrdersPage', OrdersPage, { items: [orderFixture], nextCursor: null }],
  ] as const)('%s', (_name, schema, fixture) => {
    expect(schema.parse(fixture)).toEqual(fixture);
  });
});

describe('order enums', () => {
  it('match the spec', () => {
    expect(OrderType.options).toEqual(['MARKET', 'LIMIT']);
    expect(ProductType.options).toEqual(['DELIVERY', 'INTRADAY']);
    expect(OrderStatus.options).toEqual(['AMO', 'OPEN', 'EXECUTED', 'CANCELLED', 'REJECTED']);
  });
});

describe('PlaceOrderRequest', () => {
  it('fails a LIMIT order without a price', () => {
    const result = PlaceOrderRequest.safeParse({ ...placeLimitFixture, price: undefined });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Enter a limit price');
  });

  it('fails a MARKET order with a price', () => {
    const result = PlaceOrderRequest.safeParse({ ...placeMarketFixture, price: 152_345 });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('A market order has no price');
  });

  it('requires qty to be an integer of at least 1', () => {
    for (const qty of [0, -1, 1.5]) {
      expect(PlaceOrderRequest.safeParse({ ...placeLimitFixture, qty }).success).toBe(false);
    }
    expect(messages(PlaceOrderRequest.safeParse({ ...placeLimitFixture, qty: 0 }))).toContain(
      'Quantity must be at least 1',
    );
    expect(PlaceOrderRequest.parse({ ...placeLimitFixture, qty: 1 }).qty).toBe(1);
  });

  it('requires the price to be a multiple of 5 paise', () => {
    const result = PlaceOrderRequest.safeParse({ ...placeLimitFixture, price: 152_343 });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Price must be a multiple of 5 paise');
    expect(PlaceOrderRequest.safeParse({ ...placeLimitFixture, price: 1523.45 }).success).toBe(
      false,
    );
    expect(PlaceOrderRequest.safeParse({ ...placeLimitFixture, price: 152_340 }).success).toBe(
      true,
    );
  });
});

describe('ModifyOrderRequest', () => {
  it('needs at least one change', () => {
    expect(messages(ModifyOrderRequest.safeParse({}))).toContain('Nothing to change');
  });

  it('applies the same price rules when the type changes', () => {
    expect(ModifyOrderRequest.safeParse({ type: 'LIMIT' }).success).toBe(false);
    expect(ModifyOrderRequest.safeParse({ type: 'MARKET', price: 100 }).success).toBe(false);
    expect(ModifyOrderRequest.safeParse({ type: 'MARKET' }).success).toBe(true);
    expect(ModifyOrderRequest.safeParse({ type: 'LIMIT', price: 100 }).success).toBe(true);
  });

  it('validates qty and tick', () => {
    expect(ModifyOrderRequest.safeParse({ qty: 0 }).success).toBe(false);
    expect(ModifyOrderRequest.safeParse({ price: 101 }).success).toBe(false);
  });
});

describe('Order and OrdersQuery', () => {
  it('allows a null price for MARKET and rejects off-tick fills', () => {
    expect(Order.safeParse({ ...orderFixture, type: 'MARKET', price: null }).success).toBe(true);
    expect(Order.safeParse({ ...orderFixture, avgFillPrice: 152_341 }).success).toBe(false);
  });

  it('filters by status and coerces the limit', () => {
    expect(OrdersQuery.parse({ status: 'OPEN', limit: '25' })).toEqual({
      status: 'OPEN',
      limit: 25,
    });
    expect(OrdersQuery.safeParse({ status: 'PENDING' }).success).toBe(false);
  });
});

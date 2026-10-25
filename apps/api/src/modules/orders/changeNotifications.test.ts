import type { Order, TrailingStop } from '@nthstock/contracts';
import type { PaperEngineWorkingSet } from '@nthstock/paperEngine';
import { describe, expect, it } from 'vitest';
import { notificationsForChange } from './changeNotifications.js';

// Which account changes raise which notifications (NSTOCK-0379).

const TS = '2026-10-25T04:30:00.000Z';

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'ord_1',
  clientOrderId: null,
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  side: 'BUY',
  type: 'LIMIT',
  product: 'DELIVERY',
  qty: 10,
  price: 153_000,
  filledQty: 0,
  avgFillPrice: null,
  status: 'OPEN',
  statusReason: null,
  validity: 'DAY',
  placedAt: TS,
  updatedAt: TS,
  ...overrides,
});

const executed = (overrides: Partial<Order> = {}) =>
  order({ status: 'EXECUTED', filledQty: 10, avgFillPrice: 153_000, ...overrides });

const stop = (overrides: Partial<TrailingStop> = {}): TrailingStop => ({
  id: 'ts_1',
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'DELIVERY',
  direction: 'LONG',
  trail: { unit: 'AMOUNT', amount: 1_250 },
  activationPrice: null,
  exitOrderType: 'MARKET',
  exitLimitOffset: null,
  status: 'TRAILING',
  statusReason: null,
  watermarkPrice: 153_540,
  stopPrice: 152_290,
  protectedQty: 10,
  entryOrderId: 'ord_1',
  exitOrderId: null,
  seq: 3,
  createdAt: TS,
  updatedAt: TS,
  ...overrides,
});

const workingSet = (
  orders: Order[],
  trailingStops: TrailingStop[] = [],
  ledger: PaperEngineWorkingSet['ledger']['entries'] = [],
): PaperEngineWorkingSet =>
  ({
    v: 4,
    syncedTo: TS,
    seq: 1,
    orders,
    rejectCodes: [],
    positions: [],
    holdings: [],
    holdingSales: [],
    openingBalance: 10_00_000_00,
    ledger: { carried: { balance: 10_00_000_00, blocked: 0 }, entries: ledger },
    history: [],
    trailingStops,
    exitOrderIds: [],
    trailingStopRequestIds: [],
  }) as unknown as PaperEngineWorkingSet;

const kinds = (before: PaperEngineWorkingSet | null, after: PaperEngineWorkingSet) =>
  notificationsForChange('usr_a', { before, after }).map((n) => n.kind);

describe('notificationsForChange', () => {
  it('notifies an order that executed, with the fill in the body', () => {
    const [note] = notificationsForChange('usr_a', {
      before: workingSet([order()]),
      after: workingSet([executed()]),
    });
    expect(note).toEqual({
      userId: 'usr_a',
      kind: 'ORDER_FILLED',
      refId: 'ord_1',
      title: 'Order executed',
      body: 'BUY 10 INFY @ ₹1,530.00',
      symbol: 'INFY',
      exchange: 'NSE',
    });
  });

  it('notifies a market order that executed in its first commit', () => {
    expect(kinds(null, workingSet([executed({ type: 'MARKET', price: null })]))).toEqual([
      'ORDER_FILLED',
    ]);
  });

  it('notifies nothing for a partial fill, an unchanged order or a replayed change', () => {
    const partial = order({ filledQty: 4, avgFillPrice: 153_000 });
    expect(kinds(workingSet([order()]), workingSet([partial]))).toEqual([]);
    expect(kinds(workingSet([executed()]), workingSet([executed()]))).toEqual([]);
  });

  it('notifies a rejection with its reason', () => {
    const [note] = notificationsForChange('usr_a', {
      before: null,
      after: workingSet([order({ status: 'REJECTED', statusReason: 'Insufficient funds' })]),
    });
    expect(note).toMatchObject({
      kind: 'ORDER_REJECTED',
      title: 'Order rejected',
      body: 'BUY 10 INFY · Insufficient funds',
    });
  });

  it('notifies an AMO the 9:15 release sent, and its fill', () => {
    expect(kinds(workingSet([order({ status: 'AMO' })]), workingSet([order()]))).toEqual([
      'AMO_RELEASED',
    ]);
    expect(kinds(workingSet([order({ status: 'AMO' })]), workingSet([executed()]))).toEqual([
      'AMO_RELEASED',
      'ORDER_FILLED',
    ]);
    expect(
      kinds(workingSet([order({ status: 'AMO' })]), workingSet([order({ status: 'CANCELLED' })])),
    ).toEqual([]);
  });

  it('notifies the intraday square-off as SQUARED_OFF, not as a plain fill', () => {
    const squared = executed({
      id: 'ord_sq',
      side: 'SELL',
      product: 'INTRADAY',
      statusReason: 'Squared off automatically at 3:20 PM IST.',
    });
    const [note] = notificationsForChange('usr_a', {
      before: workingSet([]),
      after: workingSet([squared]),
    });
    expect(note).toMatchObject({ kind: 'SQUARED_OFF', title: 'INFY squared off', refId: 'ord_sq' });
  });

  it('notifies a trailing stop once, when it triggers, also when its exit fills in the same change', () => {
    const [note] = notificationsForChange('usr_a', {
      before: workingSet([], [stop()]),
      after: workingSet([], [stop({ status: 'TRIGGERED' })]),
    });
    expect(note).toMatchObject({
      kind: 'TRAILING_STOP',
      refId: 'ts_1',
      title: 'INFY trailing stop triggered',
      body: 'Stop ₹1,522.90 reached · exiting 10 shares',
    });
    expect(kinds(workingSet([], [stop()]), workingSet([], [stop({ status: 'EXECUTED' })]))).toEqual(
      ['TRAILING_STOP'],
    );
    expect(
      kinds(
        workingSet([], [stop({ status: 'TRIGGERED' })]),
        workingSet([], [stop({ status: 'EXECUTED' })]),
      ),
    ).toEqual([]);
  });

  it('notifies nothing for a change that replaces the account', () => {
    expect(
      notificationsForChange('usr_a', {
        before: workingSet([order()]),
        after: workingSet([executed()]),
        replace: true,
      }),
    ).toEqual([]);
  });
});

import { TrailingStop, type PlaceTrailingStopRequest } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { createEngineContext } from './context.js';
import { PaperEngine, type PaperEngineSnapshot } from './paperEngine.js';
import {
  INFY,
  TCS,
  createHarness,
  ist,
  legacySnapshot,
  marketOrder,
  order,
  seeded,
  type Harness,
} from './testHarness.js';

// SPEC-TFC-1 §6 and PLAN-TFC-1 T06: the trailing-stop lifecycle inside the paper engine.

const OPENING = 10_00_000_00;

const stopRequest = (
  overrides: Partial<PlaceTrailingStopRequest> = {},
): PlaceTrailingStopRequest => ({
  token: INFY.token,
  product: 'DELIVERY',
  trail: { unit: 'AMOUNT', amount: 10_00 },
  activationPrice: null,
  exitOrderType: 'MARKET',
  exitLimitOffset: null,
  ...overrides,
});

const limitExit = (offset: number) =>
  ({ exitOrderType: 'LIMIT', exitLimitOffset: offset }) as const;

/** One tick of INFY at `price`. */
function tick({ engine, prices }: Harness, price: number): void {
  prices.set(INFY.token, price);
  engine.sync();
}

function netQty({ engine }: Harness, product = 'DELIVERY'): number {
  return (
    engine.positions().find((p) => p.token === INFY.token && p.product === product)?.book.netQty ??
    0
  );
}

/** A harness holding a long INFY position bought at ₹1,500.00. */
function longHarness(qty = 10, product: 'DELIVERY' | 'INTRADAY' = 'DELIVERY') {
  const harness = createHarness();
  harness.engine.place(marketOrder({ qty, product }));
  return harness;
}

function placed(harness: Harness, overrides: Partial<PlaceTrailingStopRequest> = {}) {
  const result = harness.engine.placeTrailingStop(stopRequest(overrides));
  if (!result.ok) throw new Error(`expected a trailing stop: ${result.reason}`);
  return result.trailingStop;
}

const stopOf = ({ engine }: Harness, id: string) => engine.getTrailingStop(id);

describe('standalone trailing stops (SPEC-TFC-1 §6.2, §6.3)', () => {
  it('trails from the LTP, ratchets only up, and exits once at the stop', () => {
    const harness = longHarness();
    const stop = placed(harness);
    expect(stop).toMatchObject({
      status: 'TRAILING',
      direction: 'LONG',
      watermarkPrice: 1_500_00,
      stopPrice: 1_490_00,
      protectedQty: 10,
      entryOrderId: null,
      exitOrderId: null,
    });
    expect(TrailingStop.safeParse(stop).success).toBe(true);

    tick(harness, 1_520_00);
    expect(stopOf(harness, stop.id)).toMatchObject({
      watermarkPrice: 1_520_00,
      stopPrice: 1_510_00,
    });
    tick(harness, 1_515_00);
    expect(stopOf(harness, stop.id)).toMatchObject({
      watermarkPrice: 1_520_00,
      stopPrice: 1_510_00,
    });

    tick(harness, 1_510_00);
    const done = stopOf(harness, stop.id);
    expect(done).toMatchObject({ status: 'EXECUTED', protectedQty: 0, statusReason: null });
    const exit = harness.engine.getOrder(done?.exitOrderId ?? '');
    expect(exit).toMatchObject({
      side: 'SELL',
      type: 'MARKET',
      qty: 10,
      status: 'EXECUTED',
      avgFillPrice: 1_510_00,
      statusReason: 'Trailing stop exit: the price reached the stop at ₹1,510.00.',
    });
    expect(netQty(harness)).toBe(0);

    // Later ticks change nothing: the exit was placed exactly once.
    tick(harness, 1_400_00);
    expect(harness.engine.orders()).toHaveLength(2);
    expect(harness.stopUpdates.map((s) => s.status)).toEqual([
      'TRAILING',
      'TRAILING',
      'TRIGGERED',
      'EXECUTED',
    ]);
  });

  it('fires once on a gap well through the stop, at the gap price', () => {
    const harness = longHarness();
    const stop = placed(harness);
    tick(harness, 1_450_00);
    const exit = harness.engine.getOrder(stopOf(harness, stop.id)?.exitOrderId ?? '');
    expect(exit).toMatchObject({ status: 'EXECUTED', avgFillPrice: 1_450_00 });
    tick(harness, 1_440_00);
    expect(harness.engine.orders('EXECUTED')).toHaveLength(2);
  });

  it('waits ARMED for its activation price, then trails from it', () => {
    const harness = longHarness();
    const stop = placed(harness, { activationPrice: 1_520_00 });
    expect(stop).toMatchObject({ status: 'ARMED', watermarkPrice: null, stopPrice: null });
    tick(harness, 1_510_00);
    expect(stopOf(harness, stop.id)?.status).toBe('ARMED');
    tick(harness, 1_525_00);
    expect(stopOf(harness, stop.id)).toMatchObject({
      status: 'TRAILING',
      watermarkPrice: 1_525_00,
      stopPrice: 1_515_00,
    });
  });

  it('mirrors for a short: the stop sits above and the buy-back settles even without the cash', () => {
    const harness = createHarness({ funds: { openingBalance: 50_000_00 } });
    harness.engine.place(marketOrder({ side: 'SELL', product: 'INTRADAY', qty: 10 }));
    // Spend the cash, so a normal buy of 10 INFY would be refused.
    harness.engine.place(marketOrder({ token: TCS.token, qty: 17 }));
    expect(harness.engine.fundsSummary().available).toBeLessThan(15_000_00);

    const stop = placed(harness, { product: 'INTRADAY' });
    expect(stop).toMatchObject({ direction: 'SHORT', stopPrice: 1_510_00, protectedQty: 10 });
    tick(harness, 1_480_00);
    expect(stopOf(harness, stop.id)).toMatchObject({
      watermarkPrice: 1_480_00,
      stopPrice: 1_490_00,
    });
    tick(harness, 1_492_00);
    expect(stopOf(harness, stop.id)?.status).toBe('EXECUTED');
    expect(harness.engine.getOrder(stopOf(harness, stop.id)?.exitOrderId ?? '')).toMatchObject({
      side: 'BUY',
      status: 'EXECUTED',
      avgFillPrice: 1_492_00,
    });
    expect(netQty(harness, 'INTRADAY')).toBe(0);
    const entries = harness.engine.ledger.entries();
    expect(entries.reduce((total, e) => total + e.amount, 0)).toBe(harness.engine.ledger.available);
  });

  it('refuses with the §6.6 messages', () => {
    const flat = createHarness();
    expect(flat.engine.placeTrailingStop(stopRequest())).toEqual({
      ok: false,
      code: 'NO_POSITION',
      reason: 'Open a position first. A trailing stop protects an existing position.',
      trailingStop: null,
    });
    const harness = longHarness();
    expect(
      harness.engine.placeTrailingStop(stopRequest({ trail: { unit: 'AMOUNT', amount: 400_00 } })),
    ).toMatchObject({
      ok: false,
      code: 'INVALID_TRAIL',
      reason: 'The trail can be at most 20% of the price (₹300.00).',
    });
    expect(
      harness.engine.placeTrailingStop(
        stopRequest({ trail: { unit: 'AMOUNT', amount: 290_00 }, ...limitExit(1_300_00) }),
      ),
    ).toMatchObject({ code: 'INVALID_LIMIT_OFFSET' });
    harness.prices.delete(INFY.token);
    expect(harness.engine.placeTrailingStop(stopRequest())).toMatchObject({
      code: 'NO_PRICE',
      reason: 'There is no market price for INFY yet. Try again shortly.',
    });
    expect(harness.engine.trailingStops()).toEqual([]);
    expect(harness.stopUpdates).toEqual([]);

    const off = createHarness({ trailingStops: false });
    off.engine.place(marketOrder());
    expect(off.engine.placeTrailingStop(stopRequest())).toMatchObject({
      ok: false,
      code: 'NOT_SUPPORTED',
    });
  });

  it('replaces the position’s stop, and a retried request returns the same stop', () => {
    const harness = longHarness();
    const first = placed(harness, { clientRequestId: 'req-1' });
    expect(placed(harness, { clientRequestId: 'req-1' }).id).toBe(first.id);
    const second = placed(harness, { trail: { unit: 'PERCENT', basisPoints: 100 } });
    expect(stopOf(harness, first.id)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Replaced by a new trailing stop',
    });
    expect(second).toMatchObject({ status: 'TRAILING', stopPrice: 1_485_00 });
    expect(harness.engine.trailingStops('TRAILING')).toHaveLength(1);
  });
});

describe('limit exits and failed exits (SPEC-TFC-1 §6.4)', () => {
  /** A long with a stop at ₹1,490.00 whose limit exit at ₹1,490.00 is left working by a gap. */
  function workingLimitExit(product: 'DELIVERY' | 'INTRADAY' = 'DELIVERY') {
    const harness = longHarness(10, product);
    const stop = placed(harness, { product, ...limitExit(0) });
    tick(harness, 1_480_00);
    const triggered = stopOf(harness, stop.id);
    const exit = harness.engine.getOrder(triggered?.exitOrderId ?? '');
    return { harness, stop, exit };
  }

  it('keeps a limit exit working below its price, at stop less the offset', () => {
    const harness = longHarness();
    const stop = placed(harness, limitExit(2_00));
    tick(harness, 1_480_00);
    expect(stopOf(harness, stop.id)?.status).toBe('TRIGGERED');
    const exit = harness.engine.getOrder(stopOf(harness, stop.id)?.exitOrderId ?? '');
    expect(exit).toMatchObject({ type: 'LIMIT', price: 1_488_00, status: 'OPEN', qty: 10 });
    tick(harness, 1_488_00);
    expect(stopOf(harness, stop.id)?.status).toBe('EXECUTED');
  });

  it('cancelling the triggered stop cancels its working exit; the position stays open', () => {
    const { harness, stop, exit } = workingLimitExit();
    expect(
      harness.engine.modifyTrailingStop(stop.id, { trail: { unit: 'AMOUNT', amount: 5_00 } }),
    ).toMatchObject({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      reason: 'This trailing stop is triggered and can no longer be changed.',
    });
    expect(harness.engine.cancelTrailingStop(stop.id)).toMatchObject({
      ok: true,
      trailingStop: { status: 'CANCELLED', statusReason: 'Cancelled by you.' },
    });
    expect(harness.engine.getOrder(exit?.id ?? '')).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Cancelled with its trailing stop.',
    });
    expect(netQty(harness)).toBe(10);
    expect(harness.engine.cancelTrailingStop(stop.id)).toMatchObject({
      ok: false,
      code: 'ILLEGAL_TRANSITION',
    });
  });

  it('cancelling the exit order itself ends the stop too', () => {
    const { harness, stop, exit } = workingLimitExit();
    expect(harness.engine.cancel(exit?.id ?? '').ok).toBe(true);
    expect(stopOf(harness, stop.id)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Cancelled by you.',
    });
  });

  it('goes REJECTED with the reason when the exit is refused, leaving the position open', () => {
    const harness = longHarness();
    const stop = placed(harness, {
      trail: { unit: 'AMOUNT', amount: 290_00 },
      ...limitExit(20_00),
    });
    expect(stop.stopPrice).toBe(1_210_00);
    tick(harness, 1_205_00);
    const rejected = stopOf(harness, stop.id);
    expect(rejected).toMatchObject({ status: 'REJECTED' });
    expect(rejected?.statusReason).toMatch(/^Price ₹1,190\.00 is outside today's range/);
    expect(harness.engine.getOrder(rejected?.exitOrderId ?? '')?.status).toBe('REJECTED');
    expect(netQty(harness)).toBe(10);
    tick(harness, 1_200_00);
    expect(harness.engine.orders('REJECTED')).toHaveLength(1);
  });
});

describe('quantity, reduce-only exits and races (SPEC-TFC-1 §6.4)', () => {
  it('a manual exit and the stop on the same tick close the position once, with no flip', () => {
    const harness = longHarness(10, 'INTRADAY');
    const manual = harness.engine.place(
      order({ side: 'SELL', product: 'INTRADAY', price: 1_505_00 }),
    );
    const stop = placed(harness, { product: 'INTRADAY', ...limitExit(0) });
    // A gap triggers the stop; its limit exit at ₹1,490.00 waits below the market.
    tick(harness, 1_480_00);
    expect(stopOf(harness, stop.id)?.status).toBe('TRIGGERED');
    // One tick crosses both the manual sell and the exit: the manual one is older and fills.
    tick(harness, 1_505_00);
    expect(manual.ok && harness.engine.getOrder(manual.order.id)?.status).toBe('EXECUTED');
    expect(stopOf(harness, stop.id)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Position closed',
      protectedQty: 0,
    });
    expect(harness.engine.getOrder(stopOf(harness, stop.id)?.exitOrderId ?? '')).toMatchObject({
      status: 'CANCELLED',
      filledQty: 0,
    });
    expect(netQty(harness, 'INTRADAY')).toBe(0);
  });

  it('caps the exit at the open quantity when a manual exit took part of it', () => {
    const harness = longHarness(10, 'INTRADAY');
    const stop = placed(harness, { product: 'INTRADAY', ...limitExit(0) });
    tick(harness, 1_480_00);
    const exitId = stopOf(harness, stop.id)?.exitOrderId ?? '';
    // Sell 4 by hand: the stop now protects 6 while its exit still asks for 10.
    harness.engine.place(marketOrder({ side: 'SELL', product: 'INTRADAY', qty: 4 }));
    expect(stopOf(harness, stop.id)).toMatchObject({ status: 'TRIGGERED', protectedQty: 6 });
    tick(harness, 1_495_00);
    expect(harness.engine.getOrder(exitId)).toMatchObject({
      status: 'CANCELLED',
      filledQty: 6,
      statusReason: 'Reduce-only exit: the position is already closed.',
    });
    expect(stopOf(harness, stop.id)).toMatchObject({ status: 'EXECUTED', protectedQty: 0 });
    expect(netQty(harness, 'INTRADAY')).toBe(0);
  });

  it('protects the open quantity as manual trades shrink and grow it', () => {
    const harness = longHarness();
    const stop = placed(harness);
    harness.engine.place(marketOrder({ side: 'SELL', qty: 3 }));
    expect(stopOf(harness, stop.id)?.protectedQty).toBe(7);
    harness.engine.place(marketOrder({ qty: 5 }));
    expect(stopOf(harness, stop.id)?.protectedQty).toBe(12);
    tick(harness, 1_480_00);
    expect(harness.engine.getOrder(stopOf(harness, stop.id)?.exitOrderId ?? '')).toMatchObject({
      qty: 12,
      status: 'EXECUTED',
    });
  });

  it('is cancelled when the position closes or flips by another order', () => {
    const closing = longHarness();
    const closed = placed(closing);
    closing.engine.place(marketOrder({ side: 'SELL', qty: 10 }));
    expect(stopOf(closing, closed.id)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Position closed',
    });

    const flipping = longHarness(10, 'INTRADAY');
    const flipped = placed(flipping, { product: 'INTRADAY' });
    flipping.engine.place(marketOrder({ side: 'SELL', product: 'INTRADAY', qty: 15 }));
    expect(netQty(flipping, 'INTRADAY')).toBe(-5);
    expect(stopOf(flipping, flipped.id)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Position closed',
    });
  });

  it('fills a capped exit in parts and exits once the position is flat', () => {
    const harness = createHarness({ fillCap: (token) => (token === INFY.token ? 4 : null) });
    harness.engine.place(marketOrder());
    const stop = placed(harness, limitExit(0));
    tick(harness, 1_480_00);
    tick(harness, 1_490_00);
    expect(stopOf(harness, stop.id)).toMatchObject({ status: 'TRIGGERED', protectedQty: 6 });
    tick(harness, 1_491_00);
    expect(stopOf(harness, stop.id)).toMatchObject({ status: 'TRIGGERED', protectedQty: 2 });
    tick(harness, 1_492_00);
    expect(stopOf(harness, stop.id)).toMatchObject({ status: 'EXECUTED', protectedQty: 0 });
    expect(harness.engine.getOrder(stopOf(harness, stop.id)?.exitOrderId ?? '')).toMatchObject({
      status: 'EXECUTED',
      filledQty: 10,
      avgFillPrice: 1_490_00,
    });
  });

  it('cancels a delivery sell the exit left without shares, so nothing oversells', () => {
    const harness = longHarness();
    const stop = placed(harness);
    const manual = harness.engine.place(order({ side: 'SELL', price: 1_600_00 }));
    tick(harness, 1_480_00);
    expect(stopOf(harness, stop.id)?.status).toBe('EXECUTED');
    expect(manual.ok && harness.engine.getOrder(manual.order.id)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Cancelled: an exit already sold the shares this order would sell.',
    });
    tick(harness, 1_600_00);
    expect(netQty(harness)).toBe(0);
  });
});

describe('attached trailing stops (SPEC-TFC-1 §6.4)', () => {
  const attach = (overrides: Partial<PlaceTrailingStopRequest> = {}) => ({
    attachedTrailingStop: {
      trail: { unit: 'AMOUNT' as const, amount: 10_00 },
      activationPrice: null,
      exitOrderType: 'MARKET' as const,
      exitLimitOffset: null,
      ...overrides,
    },
  });

  it('waits for the entry, then trails from its first fill price', () => {
    const harness = createHarness();
    const entry = harness.engine.place(order({ price: 1_490_00, ...attach() }));
    if (!entry.ok) throw new Error('expected an entry');
    const [pending] = harness.engine.trailingStops();
    expect(pending).toMatchObject({
      status: 'PENDING_ENTRY',
      direction: 'LONG',
      protectedQty: 0,
      entryOrderId: entry.order.id,
    });
    // The entry rests at ₹1,490.00 and fills there when a tick crosses it.
    tick(harness, 1_485_00);
    expect(harness.engine.trailingStops()[0]).toMatchObject({
      status: 'TRAILING',
      watermarkPrice: 1_490_00,
      stopPrice: 1_480_00,
      protectedQty: 10,
    });
  });

  it('is cancelled with an entry that never filled, or one rejected at the 9:15 release', () => {
    const harness = createHarness();
    const entry = harness.engine.place(order({ price: 1_490_00, ...attach() }));
    if (!entry.ok) throw new Error('expected an entry');
    harness.engine.cancel(entry.order.id);
    expect(harness.engine.trailingStops()[0]).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Entry order cancelled before it filled',
    });

    const night = createHarness({ at: ist(25, 18, 0) });
    night.engine.place(order({ price: 1_490_00, ...attach() }));
    expect(night.engine.trailingStops()[0]?.status).toBe('PENDING_ENTRY');
    night.instruments.set({ ...INFY, lowerCircuit: 1_495_00 });
    night.clock.set(ist(28, 9, 16));
    night.engine.sync();
    expect(night.engine.trailingStops()[0]).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Entry order rejected',
    });
  });

  it('grows with partial entry fills and protects what filled when the rest is cancelled', () => {
    const harness = createHarness({ fillCap: (token) => (token === INFY.token ? 3 : null) });
    const entry = harness.engine.place(order({ price: 1_500_00, ...attach() }));
    if (!entry.ok) throw new Error('expected an entry');
    expect(harness.engine.trailingStops()[0]).toMatchObject({
      status: 'TRAILING',
      protectedQty: 3,
      watermarkPrice: 1_500_00,
    });
    tick(harness, 1_500_00);
    expect(harness.engine.trailingStops()[0]?.protectedQty).toBe(6);
    harness.engine.cancel(entry.order.id);
    expect(harness.engine.trailingStops()[0]).toMatchObject({
      status: 'TRAILING',
      protectedQty: 6,
    });
  });

  it('replaces the stop of a position it adds to and protects the whole position', () => {
    const harness = longHarness();
    const old = placed(harness);
    harness.engine.place(
      marketOrder({ qty: 5, ...attach({ trail: { unit: 'AMOUNT', amount: 20_00 } }) }),
    );
    expect(stopOf(harness, old.id)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Replaced by a new trailing stop',
    });
    expect(harness.engine.trailingStops('TRAILING')).toEqual([
      expect.objectContaining({ protectedQty: 15, stopPrice: 1_480_00 }),
    ]);
  });

  it('refuses the whole order when the attached stop breaks a §6.6 rule', () => {
    const harness = createHarness();
    expect(
      harness.engine.place(order({ ...attach({ trail: { unit: 'AMOUNT', amount: 400_00 } }) })),
    ).toMatchObject({ ok: false, code: 'INVALID_TRAIL', order: null });
    expect(harness.engine.orders()).toEqual([]);
    expect(harness.updates).toEqual([]);
  });

  it('is cancelled when an IOC entry fills nothing', () => {
    const harness = createHarness();
    harness.engine.place(order({ price: 1_490_00, validity: 'IOC', ...attach() }));
    expect(harness.engine.trailingStops()[0]).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Entry order cancelled before it filled',
    });
  });
});

describe('closePosition (SPEC-TFC-1 §6.4)', () => {
  it('cancels the stop and working orders, then exits at market, in one step', () => {
    const harness = longHarness();
    const stop = placed(harness);
    const resting = harness.engine.place(order({ qty: 5, price: 1_400_00 }));
    const result = harness.engine.closePosition(INFY.token, 'DELIVERY');
    expect(result).toMatchObject({
      ok: true,
      order: {
        side: 'SELL',
        type: 'MARKET',
        qty: 10,
        status: 'EXECUTED',
        statusReason: 'Exit to close the position.',
      },
    });
    expect(stopOf(harness, stop.id)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Position closed',
    });
    expect(resting.ok && harness.engine.getOrder(resting.order.id)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Cancelled when you closed the position.',
    });
    expect(netQty(harness)).toBe(0);
    expect(harness.engine.fundsSummary().blocked).toBe(0);
    expect(harness.engine.closePosition(INFY.token, 'DELIVERY')).toEqual({
      ok: false,
      code: 'NO_POSITION',
      reason: 'There is no open position to close.',
      order: null,
    });
  });

  it('buys back a short without the cash check, like the square-off', () => {
    const harness = createHarness({ funds: { openingBalance: 1_000_00 } });
    harness.engine.place(marketOrder({ side: 'SELL', product: 'INTRADAY', qty: 10 }));
    harness.prices.set(INFY.token, 1_700_00);
    expect(harness.engine.closePosition(INFY.token, 'INTRADAY')).toMatchObject({
      ok: true,
      order: { side: 'BUY', status: 'EXECUTED', avgFillPrice: 1_700_00 },
    });
    expect(harness.engine.fundsSummary().available).toBe(1_000_00 - 2_000_00);
  });
});

describe('day validity (SPEC-TFC-1 §6.4)', () => {
  it('expires Intraday stops at the 15:20 square-off and Delivery ones at the close', () => {
    const harness = createHarness({ at: ist(25, 15, 0) });
    harness.engine.place(marketOrder({ product: 'INTRADAY' }));
    harness.engine.place(marketOrder());
    const intraday = placed(harness, { product: 'INTRADAY' });
    const delivery = placed(harness);

    harness.clock.set(ist(25, 15, 21));
    harness.engine.sync();
    expect(stopOf(harness, intraday.id)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Expired at close',
    });
    expect(netQty(harness, 'INTRADAY')).toBe(0);
    expect(stopOf(harness, delivery.id)?.status).toBe('TRAILING');

    harness.clock.set(ist(25, 15, 31));
    harness.engine.sync();
    expect(stopOf(harness, delivery.id)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Expired at close',
    });
  });
});

describe('modify (SPEC-TFC-1 §6.5)', () => {
  function trailingAt1520() {
    const harness = longHarness();
    const stop = placed(harness);
    tick(harness, 1_520_00);
    return { harness, stop };
  }

  it('widens or tightens the trail from the watermark', () => {
    const { harness, stop } = trailingAt1520();
    expect(
      harness.engine.modifyTrailingStop(stop.id, { trail: { unit: 'AMOUNT', amount: 20_00 } }),
    ).toMatchObject({ ok: true, trailingStop: { stopPrice: 1_500_00, watermarkPrice: 1_520_00 } });
    tick(harness, 1_525_00);
    expect(stopOf(harness, stop.id)?.stopPrice).toBe(1_505_00);
  });

  it('turns a dragged stop into a trail from the watermark, refusing one at or through the LTP', () => {
    const { harness, stop } = trailingAt1520();
    tick(harness, 1_518_00);
    expect(harness.engine.modifyTrailingStop(stop.id, { stopPrice: 1_515_00 })).toMatchObject({
      ok: true,
      trailingStop: { stopPrice: 1_515_00, trail: { unit: 'AMOUNT', amount: 5_00 } },
    });
    expect(harness.engine.modifyTrailingStop(stop.id, { stopPrice: 1_520_00 })).toMatchObject({
      ok: false,
      code: 'INVALID_STOP_PRICE',
      reason: 'That stop would trigger immediately.',
      trailingStop: { stopPrice: 1_515_00 },
    });
  });

  it('refuses a tighter trail that would put the stop through a price that has fallen', () => {
    const { harness, stop } = trailingAt1520();
    tick(harness, 1_512_00);
    expect(
      harness.engine.modifyTrailingStop(stop.id, { trail: { unit: 'AMOUNT', amount: 5_00 } }),
    ).toMatchObject({ ok: false, code: 'INVALID_STOP_PRICE' });
    expect(stopOf(harness, stop.id)?.stopPrice).toBe(1_510_00);
  });

  it('changes the exit and activation, and refuses bad or empty changes', () => {
    const { harness, stop } = trailingAt1520();
    expect(harness.engine.modifyTrailingStop(stop.id, {})).toMatchObject({
      code: 'NOTHING_TO_CHANGE',
    });
    expect(harness.engine.modifyTrailingStop(stop.id, { exitOrderType: 'LIMIT' })).toMatchObject({
      code: 'INVALID_LIMIT_OFFSET',
      reason: 'Enter a limit offset',
    });
    expect(harness.engine.modifyTrailingStop(stop.id, limitExit(1_00))).toMatchObject({
      ok: true,
      trailingStop: { exitOrderType: 'LIMIT', exitLimitOffset: 1_00 },
    });
    expect(harness.engine.modifyTrailingStop(stop.id, { exitOrderType: 'MARKET' })).toMatchObject({
      ok: true,
      trailingStop: { exitOrderType: 'MARKET', exitLimitOffset: null },
    });
    expect(harness.engine.modifyTrailingStop('nope', { activationPrice: 1_600_00 })).toEqual({
      ok: false,
      code: 'TRAILING_STOP_NOT_FOUND',
      reason: 'This trailing stop was not found.',
      trailingStop: null,
    });
  });
});

describe('seq, snapshots and reset (ADR 0012, SPEC-TFC-1 §10.3)', () => {
  it('stamps every order and stop change with a rising seq', () => {
    const harness = longHarness();
    const stop = placed(harness);
    tick(harness, 1_520_00);
    tick(harness, 1_505_00);
    tick(harness, 1_500_00);
    const seqs = [...harness.updates, ...harness.stopUpdates]
      .map((change) => change.seq ?? -1)
      .sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    expect(harness.engine.seq).toBe(seqs.length);
    expect(stopOf(harness, stop.id)?.seq).toBe(harness.engine.seq);
  });

  it('restores trailing stops and seq from a snapshot and carries on', () => {
    const harness = longHarness(10, 'INTRADAY');
    harness.engine.place(marketOrder());
    placed(harness);
    const limit = placed(harness, { product: 'INTRADAY', ...limitExit(0) });
    tick(harness, 1_480_00);
    expect(stopOf(harness, limit.id)?.status).toBe('TRIGGERED');

    const restored = new PaperEngine({
      ctx: createEngineContext({ clock: harness.clock, prices: harness.prices }),
      instruments: harness.instruments,
      snapshot: JSON.parse(JSON.stringify(harness.engine.snapshot())) as PaperEngineSnapshot,
    });
    expect(restored.trailingStops()).toEqual(harness.engine.trailingStops());
    expect(restored.seq).toBe(harness.engine.seq);
    expect(restored.snapshot()).toEqual(harness.engine.snapshot());

    // The restored exit is still reduce-only: sell 4 by hand, then the exit closes only 6.
    restored.place(marketOrder({ side: 'SELL', product: 'INTRADAY', qty: 4 }));
    harness.prices.set(INFY.token, 1_495_00);
    restored.sync();
    expect(restored.getTrailingStop(limit.id)).toMatchObject({ status: 'EXECUTED' });
    expect(restored.positions().find((p) => p.product === 'INTRADAY')?.book.netQty).toBe(0);
    expect(restored.seq).toBeGreaterThan(harness.engine.seq);
  });

  it('restores a version 1 snapshot with no trailing stops and seq from its orders', () => {
    const harness = longHarness();
    const restored = new PaperEngine({
      ctx: createEngineContext({ clock: harness.clock, prices: harness.prices }),
      instruments: harness.instruments,
      snapshot: legacySnapshot(harness.engine),
    });
    expect(restored.trailingStops()).toEqual([]);
    expect(restored.seq).toBe(0);
    expect(restored.placeTrailingStop(stopRequest())).toMatchObject({
      ok: true,
      trailingStop: { seq: 1, protectedQty: 10 },
    });
  });

  it('reset cancels every active stop and clears them', () => {
    const harness = longHarness();
    placed(harness);
    harness.engine.reset();
    expect(harness.stopUpdates.at(-1)).toMatchObject({
      status: 'CANCELLED',
      statusReason: 'Cancelled when you reset your paper balance.',
    });
    expect(harness.engine.trailingStops()).toEqual([]);
    expect(harness.engine.fundsSummary().available).toBe(OPENING);
  });
});

describe('randomised runs: one stop per position, always protecting the open quantity', () => {
  it.each([7, 19, 2026])('seed %i', (seed) => {
    const rand = seeded(seed);
    const harness = createHarness({ funds: { openingBalance: 50_00_000_00 } });
    let price = 1_500_00;
    for (let step = 0; step < 400; step += 1) {
      const roll = rand();
      if (roll < 0.15) {
        const qty = 1 + Math.floor(rand() * 8);
        harness.engine.place(
          marketOrder({ product: 'INTRADAY', qty, side: rand() < 0.5 ? 'BUY' : 'SELL' }),
        );
      } else if (roll < 0.25) {
        harness.engine.placeTrailingStop(
          stopRequest({
            product: 'INTRADAY',
            trail: { unit: 'AMOUNT', amount: 5_00 * (1 + Math.floor(rand() * 6)) },
            ...(rand() < 0.5 ? limitExit(5 * Math.floor(rand() * 3)) : {}),
          }),
        );
      } else if (roll < 0.3) {
        harness.engine.place(
          order({
            product: 'INTRADAY',
            side: rand() < 0.5 ? 'BUY' : 'SELL',
            qty: 1 + Math.floor(rand() * 5),
            price: price + 5 * Math.round((rand() - 0.5) * 400),
          }),
        );
      } else {
        price = Math.min(
          1_790_00,
          Math.max(1_210_00, price + 5 * Math.round((rand() - 0.5) * 200)),
        );
        harness.prices.set(INFY.token, price);
        harness.engine.sync();
      }
      const net = netQty(harness, 'INTRADAY');
      const protecting = harness.engine
        .trailingStops()
        .filter((s) => ['ARMED', 'TRAILING', 'TRIGGERED'].includes(s.status));
      expect(protecting.length).toBeLessThanOrEqual(1);
      for (const stop of protecting) {
        expect(net).not.toBe(0);
        expect(stop.direction).toBe(net > 0 ? 'LONG' : 'SHORT');
        expect(stop.protectedQty).toBe(Math.abs(net));
      }
      const { ledger } = harness.engine;
      expect(ledger.entries().reduce((total, e) => total + e.amount, 0)).toBe(ledger.available);
    }
  });
});

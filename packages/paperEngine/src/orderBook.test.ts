import type { PositionDirection, Trail } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { BinaryHeap } from './binaryHeap.js';
import { OrderBook, type BookOrder, type BookStop } from './orderBook.js';
import { seeded } from './testHarness.js';
import { stepTrailingStop, type TrailingStopState } from './trailingStop.js';

const order = (orderId: string, side: 'BUY' | 'SELL', price: number, version = 1): BookOrder => ({
  orderId,
  userId: 'u1',
  version,
  side,
  price,
});

const trailing = (
  stopId: string,
  direction: PositionDirection,
  watermarkPrice: number,
  stopPrice: number,
  trail: Trail = { unit: 'AMOUNT', amount: 10_00 },
  version = 1,
): BookStop => ({
  stopId,
  userId: 'u1',
  version,
  state: { status: 'TRAILING', direction, trail, activationPrice: null, watermarkPrice, stopPrice },
});

const ids = (orders: readonly BookOrder[]) => orders.map((o) => o.orderId).sort();

describe('BinaryHeap', () => {
  it('pops in order', () => {
    const rand = seeded(3);
    const heap = new BinaryHeap<number>((a, b) => a < b);
    const values = Array.from({ length: 200 }, () => Math.floor(rand() * 1_000));
    for (const value of values) heap.push(value);
    const out: number[] = [];
    for (let next = heap.pop(); next !== undefined; next = heap.pop()) out.push(next);
    expect(out).toEqual([...values].sort((a, b) => a - b));
    expect(heap.size).toBe(0);
  });
});

describe('OrderBook (NSTOCK-0363)', () => {
  it('crosses a BUY LIMIT at or above the LTP and a SELL LIMIT at or below it', () => {
    const book = new OrderBook();
    book.upsertOrder(order('b1', 'BUY', 100_00));
    book.upsertOrder(order('b2', 'BUY', 99_00));
    book.upsertOrder(order('s1', 'SELL', 101_00));
    book.upsertOrder(order('s2', 'SELL', 102_00));

    expect(ids(book.tick(100_50).crossed)).toEqual([]);
    const tick = book.tick(100_00);
    expect(ids(tick.crossed)).toEqual(['b1']);
    // It pops only the entry it crossed; the next one is only looked at.
    expect(tick.read).toBe(1);
    expect(ids(book.tick(102_00).crossed)).toEqual(['s1', 's2']);
    expect(book.size).toEqual({ orders: 1, stops: 0, alerts: 0 });
  });

  it('applies a change only when its version is newer', () => {
    const book = new OrderBook();
    expect(book.upsertOrder(order('o1', 'BUY', 100_00, 2))).toBe(true);
    expect(book.upsertOrder(order('o1', 'BUY', 105_00, 1))).toBe(false);
    expect(book.upsertOrder(order('o1', 'BUY', 98_00, 3))).toBe(true);
    // The modify moved it: the old price no longer crosses.
    expect(book.tick(99_00).crossed).toEqual([]);
    expect(book.removeOrder('o1', 3)).toBe(false);
    expect(book.removeOrder('o1', 4)).toBe(true);
    // A late ADD older than the cancel stays out.
    expect(book.upsertOrder(order('o1', 'BUY', 98_00, 3))).toBe(false);
    expect(book.tick(90_00).crossed).toEqual([]);
  });

  it('puts a crossed order back at the same version, unless a newer change came first', () => {
    const book = new OrderBook();
    const o1 = order('o1', 'SELL', 100_00, 5);
    book.upsertOrder(o1);
    expect(book.tick(100_00).crossed).toEqual([o1]);
    expect(book.hasOrder('o1')).toBe(false);
    expect(book.restoreOrder(o1)).toBe(true);
    expect(book.tick(100_05).crossed).toEqual([o1]);
    book.removeOrder('o1', 6);
    expect(book.restoreOrder(o1)).toBe(false);
  });

  it('keeps the heap entry of an order upserted at the same price, and lists the orders', () => {
    const book = new OrderBook();
    book.upsertOrder(order('o1', 'SELL', 100_00, 1));
    book.upsertOrder(order('o2', 'BUY', 90_00, 1));
    for (let version = 2; version <= 50; version += 1)
      book.upsertOrder(order('o1', 'SELL', 100_00, version));
    expect([...book.orders()].map((o) => [o.orderId, o.version]).sort()).toEqual([
      ['o1', 50],
      ['o2', 1],
    ]);
    // One entry read for the one order crossed: the 49 upserts left nothing stale behind it.
    const tick = book.tick(100_00);
    expect(tick.crossed).toEqual([order('o1', 'SELL', 100_00, 50)]);
    expect(tick.read).toBe(1);
  });

  it('ratchets a trailing stop and re-keys it, so it triggers at the new stop', () => {
    const book = new OrderBook();
    book.upsertStop(trailing('t1', 'LONG', 100_00, 90_00));

    const up = book.tick(110_00);
    expect(up.moved.map((s) => s.state.stopPrice)).toEqual([100_00]);
    // 95 would have triggered nothing at the old 90 stop; at the ratcheted 100 stop, 99 triggers.
    const down = book.tick(99_00);
    expect(down.triggered.map((s) => [s.stopId, s.state.status])).toEqual([['t1', 'TRIGGERED']]);
    expect(book.hasStop('t1')).toBe(false);
  });

  it('moves a resting trailing stop by a newer version, and the old price no longer triggers', () => {
    const book = new OrderBook();
    book.upsertStop(trailing('t1', 'LONG', 100_00, 90_00));
    // A newer version moves the stop down to 80; an older one is ignored.
    expect(book.upsertStop(trailing('t1', 'LONG', 100_00, 80_00, undefined, 2))).toBe(true);
    expect(book.upsertStop(trailing('t1', 'LONG', 100_00, 95_00, undefined, 1))).toBe(false);

    // 85 crosses only the old 90 stop: the replaced entry is dropped, nothing triggers.
    const stale = book.tick(85_00);
    expect(stale.triggered).toEqual([]);
    expect(stale.read).toBe(2); // the replaced stop and watermark entries
    expect(book.hasStop('t1')).toBe(true);

    const hit = book.tick(80_00);
    expect(hit.triggered.map((s) => [s.stopId, s.state.status])).toEqual([['t1', 'TRIGGERED']]);

    // A cancel stops it from ever triggering.
    book.upsertStop(trailing('t2', 'LONG', 100_00, 90_00, undefined, 1));
    expect(book.removeStop('t2', 2)).toBe(true);
    expect(book.tick(50_00).triggered).toEqual([]);
    expect(book.hasStop('t2')).toBe(false);
  });

  it('activates an ARMED stop at its activation price, and at once without one', () => {
    const book = new OrderBook();
    const armed = (stopId: string, direction: PositionDirection, activationPrice: number | null) =>
      book.upsertStop({
        stopId,
        userId: 'u1',
        version: 1,
        state: {
          status: 'ARMED',
          direction,
          trail: { unit: 'AMOUNT', amount: 5_00 },
          activationPrice,
          watermarkPrice: null,
          stopPrice: null,
        },
      });
    armed('long', 'LONG', 105_00);
    armed('short', 'SHORT', 95_00);
    armed('now', 'SHORT', null);

    expect(book.tick(100_00).moved.map((s) => s.stopId)).toEqual(['now']);
    const tick = book.tick(105_00);
    expect(tick.moved.map((s) => [s.stopId, s.state.status, s.state.stopPrice])).toEqual([
      ['long', 'TRAILING', 100_00],
    ]);
    expect(book.tick(95_00).moved.map((s) => s.stopId)).toEqual(['short']);
  });

  it('drops stops that leave ARMED and TRAILING, and stale stop commands', () => {
    const book = new OrderBook();
    const stop = trailing('t1', 'SHORT', 100_00, 110_00, { unit: 'AMOUNT', amount: 10_00 }, 2);
    book.upsertStop(stop);
    expect(book.upsertStop({ ...stop, version: 1 })).toBe(false);
    expect(
      book.upsertStop({ ...stop, version: 3, state: { ...stop.state, status: 'CANCELLED' } }),
    ).toBe(true);
    expect(book.tick(120_00).triggered).toEqual([]);
    expect(book.removeStop('t1', 3)).toBe(false);
    expect(book.size.stops).toBe(0);
  });

  it('restores a triggered stop at the same version, not after a newer change, and lists stops', () => {
    const book = new OrderBook();
    const stop = trailing('t1', 'LONG', 100_00, 90_00, undefined, 5);
    book.upsertStop(stop);
    book.upsertStop(trailing('t2', 'SHORT', 100_00, 110_00, undefined, 5));
    expect([...book.stops()].map((s) => s.stopId).sort()).toEqual(['t1', 't2']);

    expect(book.tick(90_00).triggered.map((s) => s.stopId)).toEqual(['t1']);
    expect(book.hasStop('t1')).toBe(false);
    // An upsert at the same version does not land; only a restore puts it back.
    expect(book.upsertStop(stop)).toBe(false);
    expect(book.restoreStop(stop)).toBe(true);
    expect([...book.stops()].map((s) => s.stopId).sort()).toEqual(['t1', 't2']);
    // It rests on its stop again, so the next tick through it triggers it again.
    expect(book.tick(89_00).triggered.map((s) => s.stopId)).toEqual(['t1']);

    // A newer cancel arrived after the trigger: the restore at the old version is refused.
    book.removeStop('t1', 6);
    expect(book.restoreStop(stop)).toBe(false);
    expect(book.hasStop('t1')).toBe(false);
    // A restore of a stop never triggered is an ordinary upsert, by version.
    expect(book.restoreStop(trailing('t3', 'LONG', 100_00, 80_00, undefined, 1))).toBe(true);
    expect(book.restoreStop(trailing('t3', 'LONG', 100_00, 85_00, undefined, 1))).toBe(false);
  });

  // The property behind §5.1: a tick acts on exactly what stepping every order and stop would.
  it.each([1, 7, 42, 2026, 90210])(
    'matches a full walk of every order and stop (seed %i)',
    (seed) => {
      const rand = seeded(seed);
      const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
      const price = () => int(1_600, 2_400) * 5; // 5-paise ticks from ₹80 to ₹120
      const book = new OrderBook();
      const orders = new Map<string, BookOrder>();
      const stops = new Map<string, BookStop>();
      let ltp = 100_00;
      let n = 0;

      for (let step = 0; step < 600; step += 1) {
        const op = int(0, 9);
        if (op <= 2) {
          n += 1;
          const o = order(`o${String(n)}`, rand() < 0.5 ? 'BUY' : 'SELL', price());
          book.upsertOrder(o);
          orders.set(o.orderId, o);
        } else if (op === 3 && orders.size > 0) {
          const [id] = [...orders.keys()].slice(int(0, orders.size - 1));
          if (id) {
            book.removeOrder(id, 99);
            orders.delete(id);
          }
        } else if (op === 4) {
          n += 1;
          const direction: PositionDirection = rand() < 0.5 ? 'LONG' : 'SHORT';
          const trail: Trail =
            rand() < 0.5
              ? { unit: 'AMOUNT', amount: int(1, 100) * 5 }
              : { unit: 'PERCENT', basisPoints: int(10, 500) };
          const activationPrice = rand() < 0.4 ? null : price();
          const stop: BookStop = {
            stopId: `t${String(n)}`,
            userId: 'u1',
            version: 1,
            state: {
              status: 'ARMED',
              direction,
              trail,
              activationPrice,
              watermarkPrice: null,
              stopPrice: null,
            },
          };
          book.upsertStop(stop);
          stops.set(stop.stopId, stop);
        } else {
          ltp = Math.max(5, ltp + int(-40, 40) * 5);
          const tick = book.tick(ltp);

          const expectCrossed = [...orders.values()].filter((o) =>
            o.side === 'BUY' ? ltp <= o.price : ltp >= o.price,
          );
          for (const o of expectCrossed) orders.delete(o.orderId);
          expect(ids(tick.crossed)).toEqual(ids(expectCrossed));

          const expectTriggered: string[] = [];
          const expectMoved: string[] = [];
          for (const stop of [...stops.values()]) {
            const next = stepTrailingStop(stop.state, ltp);
            if (next.triggered) {
              stops.delete(stop.stopId);
              expectTriggered.push(stop.stopId);
            } else if (!sameState(next.state, stop.state)) {
              stops.set(stop.stopId, { ...stop, state: next.state });
              expectMoved.push(stop.stopId);
            }
          }
          expect(tick.triggered.map((s) => s.stopId).sort()).toEqual(expectTriggered.sort());
          expect(tick.moved.map((s) => s.stopId).sort()).toEqual(expectMoved.sort());
          for (const moved of tick.moved)
            expect(moved.state).toEqual(stops.get(moved.stopId)?.state);
        }
      }
      expect(book.size).toEqual({ orders: orders.size, stops: stops.size, alerts: 0 });
    },
  );
});

describe('OrderBook price alerts (NSTOCK-0383)', () => {
  const alert = (alertId: string, condition: 'ABOVE' | 'BELOW', price: number) => ({
    alertId,
    userId: 'usr_a',
    condition,
    price,
  });

  it('fires exactly the alerts a tick crosses, once each, gaps included', () => {
    const book = new OrderBook();
    book.addAlert(alert('a1', 'ABOVE', 1_530_00));
    book.addAlert(alert('a2', 'ABOVE', 1_540_00));
    book.addAlert(alert('b1', 'BELOW', 1_480_00));
    book.addAlert(alert('b2', 'BELOW', 1_470_00));
    expect(book.addAlert(alert('a1', 'ABOVE', 1_530_00))).toBe(false);

    expect(book.tick(1_500_00).alerts).toEqual([]);
    expect(book.tick(1_535_00).alerts.map((a) => a.alertId)).toEqual(['a1']);
    expect(book.tick(1_535_00).alerts).toEqual([]);
    // A gap past both BELOW levels fires both, in price order.
    expect(book.tick(1_460_00).alerts.map((a) => a.alertId)).toEqual(['b1', 'b2']);
    expect(book.size.alerts).toBe(1);
    expect([...book.alerts()].map((a) => a.alertId)).toEqual(['a2']);
  });

  it('reads only what it fires: a removed alert is dropped as a stale entry', () => {
    const book = new OrderBook();
    book.addAlert(alert('a1', 'ABOVE', 1_530_00));
    book.addAlert(alert('a2', 'ABOVE', 1_900_00));
    expect(book.removeAlert('a1')).toBe(true);
    expect(book.removeAlert('a1')).toBe(false);
    expect(book.hasAlert('a1')).toBe(false);

    const tick = book.tick(1_600_00);
    expect(tick.alerts).toEqual([]);
    expect(tick.read).toBe(1); // the stale a1 entry, then a2 stays put unread
  });
});

const sameState = (a: TrailingStopState, b: TrailingStopState) =>
  a.status === b.status && a.watermarkPrice === b.watermarkPrice && a.stopPrice === b.stopPrice;

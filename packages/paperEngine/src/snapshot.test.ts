import { describe, expect, it } from 'vitest';
import { createEngineContext } from './context.js';
import { FundsLedger } from './fundsLedger.js';
import {
  PaperEngine,
  type PaperEngineSnapshot,
  type PaperEngineSnapshotV1,
} from './paperEngine.js';
import { INFY, TCS, createHarness, ist, marketOrder, order } from './testHarness.js';

/** A busy account: fills, an open order, a rejection, an AMO-free intraday short and a holding. */
function busyHarness() {
  const harness = createHarness({
    at: ist(25, 10, 0),
    holdings: [[TCS.token, { qty: 2, investedValue: 7_000_00 }]],
  });
  const { engine } = harness;
  engine.place(marketOrder({ qty: 10, clientOrderId: 'c-1' }));
  engine.place(order({ qty: 5, price: 1_450_00 })); // OPEN
  engine.place(marketOrder({ token: TCS.token, side: 'SELL', qty: 1 })); // out of holdings
  engine.place(marketOrder({ side: 'SELL', product: 'INTRADAY', qty: 3 })); // short
  engine.place(marketOrder({ qty: 100_000 })); // REJECTED: insufficient funds
  return harness;
}

/** `list[index]`, failing the test when it is missing. */
function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`No item ${String(index)}`);
  return item;
}

function restoreFrom(harness: ReturnType<typeof createHarness>, snapshot: PaperEngineSnapshot) {
  return new PaperEngine({
    ctx: createEngineContext({ clock: harness.clock, prices: harness.prices }),
    instruments: harness.instruments,
    snapshot: JSON.parse(JSON.stringify(snapshot)) as PaperEngineSnapshot,
  });
}

describe('engine snapshot and restore', () => {
  it('carries every order, position, holding and ledger entry over, through JSON', () => {
    const harness = busyHarness();
    const { engine } = harness;
    const restored = restoreFrom(harness, engine.snapshot());

    expect(restored.orders()).toEqual(engine.orders());
    expect(restored.positions()).toEqual(engine.positions());
    expect(restored.holdings()).toEqual(engine.holdings());
    expect(restored.holdingSales()).toEqual(engine.holdingSales());
    expect(restored.fundsSummary()).toEqual(engine.fundsSummary());
    expect(restored.ledger.entries()).toEqual(engine.ledger.entries());
    expect(restored.snapshot()).toEqual(engine.snapshot());
    for (const each of engine.orders()) {
      expect(restored.orderHistory(each.id)).toEqual(engine.orderHistory(each.id));
    }
  });

  it('rebuilds a short history for orders from a snapshot saved without one', () => {
    const harness = busyHarness();
    const legacy = harness.engine.snapshot();
    delete legacy.history;
    const restored = restoreFrom(harness, legacy);
    const events = restored
      .orders()
      .map((each) => [
        each.status,
        restored.orderHistory(each.id)?.map((entry) => `${entry.event}:${entry.status}`),
      ]);
    expect(events).toEqual([
      ['EXECUTED', ['PLACED:OPEN', 'EXECUTED:EXECUTED']],
      ['OPEN', ['PLACED:OPEN']],
      ['EXECUTED', ['PLACED:OPEN', 'EXECUTED:EXECUTED']],
      ['EXECUTED', ['PLACED:OPEN', 'EXECUTED:EXECUTED']],
      ['REJECTED', ['PLACED:REJECTED']],
    ]);
    const executed = restored.orders('EXECUTED')[0];
    expect(executed && restored.orderHistory(executed.id)?.[1]?.fillPrice).toBe(
      executed?.avgFillPrice,
    );
  });

  it('keeps working after a restore: idempotent client ids, fills, cancels and reasons', () => {
    const harness = busyHarness();
    const restored = restoreFrom(harness, harness.engine.snapshot());
    const open = restored.orders('OPEN')[0];
    if (!open) throw new Error('no open order');

    const again = restored.place(marketOrder({ qty: 10, clientOrderId: 'c-1' }));
    expect(again.ok && again.order.status).toBe('EXECUTED');
    expect(restored.orders()).toHaveLength(harness.engine.orders().length);

    const rejected = restored.orders('REJECTED')[0];
    if (!rejected) throw new Error('no rejected order');
    const replay = restored.place({ ...marketOrder({ qty: 1 }), clientOrderId: undefined });
    expect(replay.ok).toBe(true);

    const blockedBefore = restored.fundsSummary().blocked;
    expect(restored.ledger.blockedFor(open.id)).toBe(5 * 1_450_00);
    harness.prices.set(INFY.token, 1_445_00);
    const changed = restored.sync();
    expect(changed.map((o) => [o.id, o.status])).toEqual([[open.id, 'EXECUTED']]);
    expect(restored.fundsSummary().blocked).toBe(blockedBefore - 5 * 1_450_00);
  });

  it('runs session events after the saved instant, not before it', () => {
    const harness = busyHarness();
    const snapshot = harness.engine.snapshot();
    harness.clock.set(ist(25, 15, 31));
    const restored = restoreFrom(harness, snapshot);
    restored.sync();
    // 15:20 squared the short off; 15:30 cancelled the open order and made holdings.
    expect(restored.orders('OPEN')).toEqual([]);
    expect(restored.positions()).toEqual([]);
    expect(restored.holdings().map((h) => [h.token, h.lot.qty])).toEqual([
      [TCS.token, 1],
      [INFY.token, 10],
    ]);
  });

  it('refuses a snapshot that is corrupt or of another version', () => {
    const harness = busyHarness();
    const good = harness.engine.snapshot();
    const bad = (change: (s: PaperEngineSnapshotV1) => void) => {
      const snapshot = JSON.parse(JSON.stringify(good)) as PaperEngineSnapshotV1;
      change(snapshot);
      return () => restoreFrom(harness, snapshot);
    };
    expect(bad((s) => ((s as { v: number }).v = 3))).toThrow(/version/);
    expect(bad((s) => (s.syncedTo = 'nope'))).toThrow(RangeError);
    expect(bad((s) => ((s.orders[0] as { qty: number }).qty = 0.5))).toThrow();
    expect(bad((s) => s.ledger.splice(1, 1, { ...at(s.ledger, 1), balanceAfter: 1 }))).toThrow(
      /add up/,
    );
    expect(bad((s) => s.ledger.shift())).toThrow(/opening credit/);
    expect(bad((s) => (at(s.holdings, 0).lot.qty = -1))).toThrow(RangeError);
    expect(bad((s) => (at(s.holdingSales, 0).proceeds = 1.5))).toThrow(RangeError);
    expect(bad((s) => (at(s.positions, 0).book.netQty = 0.5))).toThrow(RangeError);
    expect(
      () =>
        new PaperEngine({
          ctx: createEngineContext({ clock: harness.clock, prices: harness.prices }),
          instruments: harness.instruments,
          snapshot: good,
          funds: { openingBalance: 1 },
        }),
    ).toThrow(/either/);
  });

  it('a ledger replay rebuilds per-order blocks and refuses a release of more than was blocked', () => {
    const ctx = { nowIso: () => '2026-09-25T04:30:00.000Z', nextId: () => 'x' };
    let n = 0;
    const ids = { ...ctx, nextId: () => `e${String((n += 1))}` };
    const ledger = new FundsLedger(ids);
    ledger.block('o1', 100_00);
    ledger.block('o2', 50_00);
    ledger.release('o1', 40_00);
    const copy = new FundsLedger(ids, { entries: ledger.entries() });
    expect(copy.blockedFor('o1')).toBe(60_00);
    expect(copy.blockedFor('o2')).toBe(50_00);
    expect(copy.summary()).toEqual(ledger.summary());

    const entries = [...ledger.entries()];
    const tooMuch = {
      ...at(entries, 3),
      amount: 200_00,
      balanceAfter: at(entries, 2).balanceAfter + 200_00,
    };
    expect(() => new FundsLedger(ids, { entries: [...entries.slice(0, 3), tooMuch] })).toThrow(
      /more than blocked/,
    );
    const orphan = { ...at(entries, 1), orderId: null };
    expect(() => new FundsLedger(ids, { entries: [at(entries, 0), orphan] })).toThrow(/no order/);
  });
});

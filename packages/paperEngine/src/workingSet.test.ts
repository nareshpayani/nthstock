import type { OrderSide, OrderType, ProductType } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  createEngineContext,
  createManualClock,
  createMapPriceSource,
  createSequentialIds,
} from './context.js';
import { FundsLedger } from './fundsLedger.js';
import {
  PaperEngine,
  type PaperEngineSnapshot,
  type PaperEngineSnapshotV1,
  type PaperEngineWorkingSet,
} from './paperEngine.js';
import { INFY, TCS, createHarness, ist, marketOrder, order, seeded } from './testHarness.js';

type Harness = ReturnType<typeof createHarness>;

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * An engine carried on from `snapshot` with its own clock and prices (copies of the source's), so
 * two restored engines can be driven side by side. Its ids cannot clash with the source engine's.
 */
function restoreFrom(harness: Harness, snapshot: PaperEngineSnapshot): Harness {
  const clock = createManualClock(harness.clock.now());
  const prices = createMapPriceSource(
    [INFY, TCS].flatMap(({ token }) => {
      const ltp = harness.prices.getLtp(token);
      return ltp === null ? [] : [[token, ltp] as const];
    }),
  );
  const engine = new PaperEngine({
    ctx: createEngineContext({ clock, prices, nextId: createSequentialIds('r') }),
    instruments: harness.instruments,
    snapshot: roundTrip(snapshot),
  });
  return { ...harness, engine, clock, prices };
}

/** What a user can see of an account: funds, positions, holdings and today's sales. */
function view(engine: PaperEngine) {
  return {
    funds: engine.fundsSummary(),
    blocked: engine.ledger.blocked,
    positions: engine.positions(),
    holdings: engine.holdings(),
    holdingSales: engine.holdingSales(),
    live: engine.orders().filter((o) => o.status === 'AMO' || o.status === 'OPEN'),
  };
}

type Action =
  | { kind: 'place'; request: Parameters<PaperEngine['place']>[0] }
  | { kind: 'modify'; index: number; qty: number }
  | { kind: 'cancel'; index: number }
  | { kind: 'price'; token: number; ticks: number }
  | { kind: 'wait'; minutes: number };

function randomActions(rand: () => number, count: number): Action[] {
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  const actions: Action[] = [];
  for (let i = 0; i < count; i += 1) {
    const op = int(0, 9);
    if (op <= 3) {
      const type = pick<OrderType>(['MARKET', 'LIMIT']);
      actions.push({
        kind: 'place',
        request: {
          token: pick([INFY, TCS]).token,
          side: pick<OrderSide>(['BUY', 'SELL']),
          type,
          product: pick<ProductType>(['DELIVERY', 'INTRADAY']),
          qty: int(1, 20),
          ...(type === 'LIMIT' ? { price: 1_500_00 + int(-60, 60) * 5 } : {}),
        },
      });
    } else if (op === 4) actions.push({ kind: 'modify', index: int(0, 50), qty: int(1, 20) });
    else if (op === 5) actions.push({ kind: 'cancel', index: int(0, 50) });
    else if (op <= 7)
      actions.push({ kind: 'price', token: pick([INFY, TCS]).token, ticks: int(-40, 40) });
    else actions.push({ kind: 'wait', minutes: int(1, 360) });
  }
  return actions;
}

/** Runs one action; the same action on engines in the same state gives the same outcome. */
function perform(harness: Harness, engine: PaperEngine, action: Action): unknown {
  const live = engine.orders().filter((o) => o.status === 'AMO' || o.status === 'OPEN');
  const target =
    live[
      action.kind === 'modify' || action.kind === 'cancel'
        ? action.index % Math.max(live.length, 1)
        : 0
    ];
  switch (action.kind) {
    case 'place':
      return engine.place(action.request);
    case 'modify':
      return target ? engine.modify(target.id, { qty: action.qty }) : null;
    case 'cancel':
      return target ? engine.cancel(target.id) : null;
    case 'price': {
      const instrument = action.token === INFY.token ? INFY : TCS;
      const next = (harness.prices.getLtp(action.token) ?? 1_500_00) + action.ticks * 5;
      harness.prices.set(
        action.token,
        Math.min(instrument.upperCircuit, Math.max(instrument.lowerCircuit, next)),
      );
      return engine.sync();
    }
    case 'wait':
      harness.clock.advance(action.minutes * 60_000);
      return engine.sync();
  }
}

describe('engine working set (v2, T-199)', () => {
  it.each([3, 11, 42, 2026, 777])(
    'an engine restored from the working set acts like one restored from the full snapshot (seed %i)',
    (seed) => {
      const rand = seeded(seed);
      const harness = createHarness({
        at: ist(25, 9, 0),
        funds: { openingBalance: 2_00_000_00 },
        holdings: [
          [INFY.token, { qty: 20, investedValue: 28_000_00 }],
          [TCS.token, { qty: 5, investedValue: 18_000_00 }],
        ],
      });
      let smaller = 0;
      for (let round = 0; round < 12; round += 1) {
        for (const action of randomActions(rand, 40)) perform(harness, harness.engine, action);

        const full = harness.engine.snapshot();
        const working = harness.engine.workingSet();
        if (working.orders.length < full.orders.length) smaller += 1;
        const fromFull = restoreFrom(harness, full);
        const fromWorking = restoreFrom(harness, working);
        expect(view(fromWorking.engine)).toEqual(view(fromFull.engine));
        expect(view(fromFull.engine)).toEqual(view(harness.engine));

        // The next actions: the same random ones, step by step, on both.
        for (const action of randomActions(rand, 25)) {
          const a = perform(fromFull, fromFull.engine, action);
          const b = perform(fromWorking, fromWorking.engine, action);
          expect(b).toEqual(a);
          expect(view(fromWorking.engine)).toEqual(view(fromFull.engine));
        }
        // A working set taken from a restored engine is the same as the full one would give.
        expect(restoreFrom(harness, fromWorking.engine.workingSet()).engine.workingSet()).toEqual(
          fromWorking.engine.workingSet(),
        );
      }
      // The run crossed days, so the working set really left orders and entries out.
      expect(smaller).toBeGreaterThan(0);
      expect(harness.clock.now().getTime() - ist(25, 9, 0).getTime()).toBeGreaterThan(
        2 * 86_400_000,
      );
    },
    60_000,
  );

  it('keeps today and live orders, today ledger entries, and carries the balance and blocks', () => {
    const harness = createHarness({ at: ist(25, 10, 0) });
    const { engine, clock } = harness;
    engine.place(marketOrder({ qty: 10 })); // executed on day one
    clock.set(ist(25, 16, 0));
    const amo = engine.place(order({ qty: 4, price: 1_400_00 })); // AMO, cash blocked overnight
    if (!amo.ok) throw new Error('AMO refused');
    clock.set(ist(28, 10, 0)); // Monday: the AMO is released and stays open
    engine.sync();
    engine.place(order({ qty: 1, price: 1_300_00 }));

    const set = engine.workingSet();
    expect(set.v).toBe(2);
    expect(set.orders.map((o) => o.qty)).toEqual([4, 1]);
    expect(set.ledger.entries.every((e) => e.createdAt >= ist(28, 0, 0).toISOString())).toBe(true);
    expect(set.ledger.carried.blocks).toEqual([[amo.order.id, 4 * 1_400_00]]);
    expect(set.ledger.entries.length).toBeLessThan(engine.ledger.size);

    const restored = restoreFrom(harness, set).engine;
    expect(restored.ledger.available).toBe(engine.ledger.available);
    expect(restored.ledger.blocked).toBe(engine.ledger.blocked);
    expect(restored.ledger.blockedFor(amo.order.id)).toBe(4 * 1_400_00);
    expect(restored.cancel(amo.order.id).ok).toBe(true);
    expect(restored.ledger.blocked).toBe(1_300_00);
  });

  it('v1 snapshots still load, and a reset restored from a working set matches', () => {
    const harness = createHarness({ at: ist(25, 10, 0) });
    harness.engine.place(marketOrder({ qty: 10 }));
    const v1: PaperEngineSnapshotV1 = harness.engine.snapshot();
    expect(v1.v).toBe(1);
    expect(restoreFrom(harness, v1).engine.fundsSummary()).toEqual(harness.engine.fundsSummary());

    const fromWorking = restoreFrom(harness, harness.engine.workingSet()).engine;
    fromWorking.reset();
    harness.engine.reset();
    expect(fromWorking.fundsSummary()).toEqual(harness.engine.fundsSummary());
  });

  it('refuses a working set whose carried balance or entries are corrupt', () => {
    const harness = createHarness({ at: ist(25, 10, 0) });
    harness.engine.place(marketOrder({ qty: 10 }));
    harness.engine.place(order({ qty: 5, price: 1_450_00 }));
    const good = harness.engine.workingSet();
    const bad = (change: (s: PaperEngineWorkingSet) => void) => {
      const set = roundTrip(good);
      change(set);
      return () => restoreFrom(harness, set);
    };
    expect(bad((s) => (s.ledger.carried.available = 1.5))).toThrow(RangeError);
    expect(bad((s) => (s.ledger.carried.available += 1))).toThrow(/add up/);
    expect(bad((s) => (s.ledger.carried.blocks as unknown[]).push(['x', 0]))).toThrow(RangeError);
    expect(bad((s) => (s.ledger.carried.blocks as unknown[]).push(['y', 5], ['y', 5]))).toThrow(
      /repeats/,
    );
    expect(
      () =>
        new FundsLedger(
          { nowIso: () => ist(25, 10, 0).toISOString(), nextId: () => 'e' },
          {
            carried: { available: 0, blocks: [] },
          },
        ),
    ).toThrow(/needs its entries/);
  });
});

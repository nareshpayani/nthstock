import { FundsSummary, LedgerEntry, PAPER_OPENING_BALANCE_PAISE } from '@nthstock/contracts';
import { fixedClock } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { createEngineContext, createMapPriceSource, createSequentialIds } from './context.js';
import { FundsLedger } from './fundsLedger.js';
import { PaperEngine } from './paperEngine.js';
import { INFY, TCS, createHarness, marketOrder, order } from './testHarness.js';

const sum = (entries: readonly LedgerEntry[]) => entries.reduce((total, e) => total + e.amount, 0);

describe('FundsLedger.reset (T-155)', () => {
  const newLedger = () =>
    new FundsLedger(
      createEngineContext({
        clock: fixedClock('2026-09-25T04:00:00Z'),
        prices: createMapPriceSource(),
      }),
    );

  it('brings available cash back to ₹10,00,000.00 with one RESET entry', () => {
    const ledger = newLedger();
    ledger.settleSell('o1', 2_500_00);
    ledger.settleBuy('o2', 40_000_00);
    const result = ledger.reset();
    expect(result).toMatchObject({
      ok: true,
      entries: [
        {
          type: 'RESET',
          amount: 37_500_00,
          balanceAfter: PAPER_OPENING_BALANCE_PAISE,
          orderId: null,
          description: 'Paper balance reset to ₹10,00,000.00',
        },
      ],
    });
    expect(ledger.available).toBe(PAPER_OPENING_BALANCE_PAISE);
    expect(sum(ledger.entries())).toBe(PAPER_OPENING_BALANCE_PAISE);
    // Append-only: nothing earlier is dropped.
    expect(ledger.size).toBe(4);
    expect(ledger.entriesFrom(3).map((e) => e.type)).toEqual(['RESET']);
    expect(ledger.entriesFrom(-2)).toHaveLength(4);
  });

  it('writes a RESET entry even when nothing moved, and a negative one when the account is up', () => {
    const ledger = newLedger();
    expect(ledger.reset()).toMatchObject({ ok: true, entries: [{ type: 'RESET', amount: 0 }] });
    ledger.settleSell('o1', 1_000_00);
    expect(ledger.reset()).toMatchObject({ entries: [{ type: 'RESET', amount: -1_000_00 }] });
    expect(ledger.available).toBe(PAPER_OPENING_BALANCE_PAISE);
  });

  it('refuses while cash is still blocked', () => {
    const ledger = newLedger();
    ledger.block('o1', 1_000_00);
    expect(() => ledger.reset()).toThrow(/blocked/);
  });

  it('a saved ledger with a RESET entry replays', () => {
    const ledger = newLedger();
    ledger.settleBuy('o1', 5_000_00);
    ledger.reset();
    const again = new FundsLedger(
      createEngineContext({
        clock: fixedClock('2026-09-25T05:00:00Z'),
        prices: createMapPriceSource(),
      }),
      { entries: ledger.entries() },
    );
    expect(again.available).toBe(PAPER_OPENING_BALANCE_PAISE);
    expect(again.blocked).toBe(0);
  });
});

describe('PaperEngine.reset (T-155)', () => {
  it('cancels open orders, clears positions and holdings, and restores ₹10,00,000', () => {
    const { engine, updates, prices } = createHarness({
      holdings: [[TCS.token, { qty: 4, investedValue: 4 * 3_700_00 }]],
    });
    engine.place(marketOrder({ qty: 10 }));
    engine.place(marketOrder({ qty: 3, side: 'SELL', product: 'INTRADAY' }));
    const resting = engine.place(order({ qty: 5, price: 1_400_00 }));
    if (!resting.ok) throw new Error('place failed');
    prices.set(INFY.token, 1_520_00);
    engine.sync();
    expect(engine.fundsSummary().blocked).toBe(5 * 1_400_00);
    updates.length = 0;

    const cancelled = engine.reset();
    expect(cancelled.map((o) => [o.id, o.status, o.statusReason])).toEqual([
      [resting.order.id, 'CANCELLED', 'Cancelled when you reset your paper balance.'],
    ]);
    expect(updates.map((o) => [o.id, o.status])).toEqual([[resting.order.id, 'CANCELLED']]);
    expect(engine.orders()).toEqual([]);
    expect(engine.positions()).toEqual([]);
    expect(engine.holdings()).toEqual([]);
    expect(engine.holdingSales()).toEqual([]);
    expect(engine.orderHistory(resting.order.id)).toBeNull();
    const funds = FundsSummary.parse(engine.fundsSummary());
    expect(funds).toMatchObject({
      openingBalance: PAPER_OPENING_BALANCE_PAISE,
      balance: PAPER_OPENING_BALANCE_PAISE,
      available: PAPER_OPENING_BALANCE_PAISE,
      blocked: 0,
      realisedPnlToday: 0,
    });
    const ledger = engine.ledger.entries();
    expect(ledger.at(-1)).toMatchObject({
      type: 'RESET',
      balanceAfter: PAPER_OPENING_BALANCE_PAISE,
    });
    expect(ledger.at(-2)).toMatchObject({ type: 'ORDER_RELEASE', orderId: resting.order.id });
    expect(sum(ledger)).toBe(PAPER_OPENING_BALANCE_PAISE);

    // The account trades again as new, and a client order id may be used again.
    const again = engine.place(marketOrder({ qty: 1, clientOrderId: 'c1' }));
    expect(again).toMatchObject({ ok: true, order: { status: 'EXECUTED' } });
  });

  it('survives a snapshot round trip', () => {
    const { engine, clock, prices, instruments } = createHarness();
    engine.place(marketOrder({ qty: 2 }));
    engine.reset();
    const restored = new PaperEngine({
      ctx: createEngineContext({ clock, prices, nextId: createSequentialIds('r') }),
      instruments,
      snapshot: engine.snapshot(),
    });
    expect(restored.orders()).toEqual([]);
    expect(restored.fundsSummary().available).toBe(PAPER_OPENING_BALANCE_PAISE);
    expect(restored.ledger.entries().at(-1)?.type).toBe('RESET');
  });
});

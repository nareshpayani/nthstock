import { FundsSummary, LedgerEntry, PAPER_OPENING_BALANCE_PAISE } from '@nthstock/contracts';
import { fixedClock } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { createEngineContext, createMapPriceSource } from './context.js';
import { FundsLedger } from './fundsLedger.js';

const newLedger = (openingBalance?: number) =>
  new FundsLedger(
    createEngineContext({
      clock: fixedClock('2026-09-25T04:00:00Z'),
      prices: createMapPriceSource(),
    }),
    openingBalance === undefined ? {} : { openingBalance },
  );

const sum = (entries: readonly LedgerEntry[]) => entries.reduce((total, e) => total + e.amount, 0);

describe('FundsLedger (T-066)', () => {
  it('opens with a ₹10,00,000 credit', () => {
    const ledger = newLedger();
    expect(ledger.entries()).toEqual([
      {
        id: 'pe1',
        type: 'OPENING_CREDIT',
        amount: 10_00_000_00,
        balanceAfter: 10_00_000_00,
        orderId: null,
        description: 'Opening paper balance',
        createdAt: '2026-09-25T04:00:00.000Z',
      },
    ]);
    expect(PAPER_OPENING_BALANCE_PAISE).toBe(10_00_000_00);
    expect(ledger.summary()).toEqual({
      openingBalance: 10_00_000_00,
      balance: 10_00_000_00,
      blocked: 0,
      available: 10_00_000_00,
      realisedPnlToday: 0,
      asOf: '2026-09-25T04:00:00.000Z',
    });
  });

  it('blocks on place and releases on cancel', () => {
    const ledger = newLedger();
    expect(ledger.block('o1', 1_000_00)).toMatchObject({ ok: true });
    expect(ledger.available).toBe(9_99_000_00);
    expect(ledger.blocked).toBe(1_000_00);
    expect(ledger.balance).toBe(10_00_000_00);
    expect(ledger.blockedFor('o1')).toBe(1_000_00);

    const released = ledger.release('o1');
    expect(released).toMatchObject({
      ok: true,
      entries: [{ type: 'ORDER_RELEASE', amount: 1_000_00, balanceAfter: 10_00_000_00 }],
    });
    expect(ledger.blocked).toBe(0);
    expect(ledger.blockedFor('o1')).toBe(0);
    // Nothing left to release: no entry.
    expect(ledger.release('o1')).toEqual({ ok: true, entries: [] });
  });

  it('releases part of a block and blocks again on modify', () => {
    const ledger = newLedger();
    ledger.block('o1', 1_000_00);
    ledger.release('o1', 400_00);
    ledger.block('o1', 100_00);
    expect(ledger.blockedFor('o1')).toBe(700_00);
    expect(() => ledger.release('o1', 800_00)).toThrow(RangeError);
    expect(() => ledger.release('o1', -1)).toThrow(RangeError);
    expect(() => ledger.release('o1', 1.5)).toThrow(/integer/);
  });

  it('settles a BUY fill: releases the block and debits the trade value', () => {
    const ledger = newLedger();
    ledger.block('o1', 1_000_00); // 10 × ₹100 limit
    const settled = ledger.settleBuy('o1', 995_00); // filled at ₹99.50
    expect(settled).toMatchObject({
      ok: true,
      entries: [
        { type: 'ORDER_RELEASE', amount: 1_000_00, orderId: 'o1' },
        { type: 'TRADE_DEBIT', amount: -995_00, orderId: 'o1' },
      ],
    });
    expect(ledger.blocked).toBe(0);
    expect(ledger.available).toBe(10_00_000_00 - 995_00);
  });

  it('settles a BUY fill with no block (MARKET placed and filled at once)', () => {
    const ledger = newLedger();
    expect(ledger.settleBuy('o1', 500_00)).toMatchObject({
      ok: true,
      entries: [{ type: 'TRADE_DEBIT', amount: -500_00 }],
    });
  });

  it('settles a SELL fill by crediting the proceeds', () => {
    const ledger = newLedger();
    expect(ledger.settleSell('o2', 1_200_00)).toMatchObject({
      ok: true,
      entries: [{ type: 'TRADE_CREDIT', amount: 1_200_00, balanceAfter: 10_01_200_00 }],
    });
  });

  it('refuses anything that would overdraw, and appends nothing', () => {
    const ledger = newLedger(1_000_00);
    expect(ledger.block('o1', 1_000_05)).toEqual({
      ok: false,
      code: 'INSUFFICIENT_FUNDS',
      reason: 'Not enough cash: this needs ₹1,000.05 and ₹1,000.00 is available',
    });
    ledger.block('o1', 600_00);
    // Fill costs more than the block plus what is free.
    expect(ledger.settleBuy('o1', 1_000_05)).toMatchObject({ ok: false });
    expect(ledger.entries()).toHaveLength(2);
    expect(ledger.blockedFor('o1')).toBe(600_00);
    // Exactly enough is fine.
    expect(ledger.settleBuy('o1', 1_000_00)).toMatchObject({ ok: true });
    expect(ledger.available).toBe(0);
  });

  it('rejects floats and non-positive amounts', () => {
    const ledger = newLedger();
    expect(() => ledger.block('o1', 10.5)).toThrow(/integer number of paise/);
    expect(() => ledger.block('o1', 0)).toThrow(/positive/);
    expect(() => ledger.settleSell('o1', -5)).toThrow(/positive/);
    expect(() => ledger.summary(0.5)).toThrow(/integer/);
    expect(() => newLedger(-1)).toThrow(/negative/);
    expect(() => newLedger(1.5)).toThrow(/integer/);
  });

  it('is append-only: entries are frozen and a returned list cannot change the ledger', () => {
    const ledger = newLedger();
    const list = ledger.entries() as LedgerEntry[];
    list.pop();
    expect(ledger.entries()).toHaveLength(1);
    expect(Object.isFrozen(ledger.entries()[0])).toBe(true);
  });
});

/** Small seeded PRNG so the randomised test is reproducible (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('FundsLedger randomised sequences (T-066)', () => {
  it.each([1, 7, 42, 2026, 90210])('keeps its invariants for seed %i', (seed) => {
    const rand = seeded(seed);
    const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
    const ledger = newLedger();
    const open: string[] = [];
    let before: readonly LedgerEntry[] = ledger.entries();
    let refusals = 0;
    let runningSum = sum(before);

    for (let step = 0; step < 1_000; step += 1) {
      const op = int(0, 3);
      // Amounts up to ₹5,00,000 so the ledger regularly runs close to empty.
      const amount = int(1, 5_00_000_00);
      if (op === 0) {
        const id = `o${String(step)}`;
        const result = ledger.block(id, amount);
        if (result.ok) open.push(id);
        else refusals += 1;
      } else if (op === 1 && open.length > 0) {
        const [id = ''] = open.splice(int(0, open.length - 1), 1);
        ledger.release(id);
      } else if (op === 2 && open.length > 0) {
        const index = int(0, open.length - 1);
        const id = open[index] ?? '';
        // Fill below, at, or above the blocked amount.
        const cost = Math.max(1, ledger.blockedFor(id) + int(-1_000_00, 1_000_00));
        const result = ledger.settleBuy(id, cost);
        if (result.ok) open.splice(index, 1);
        else refusals += 1;
      } else {
        ledger.settleSell(`s${String(step)}`, int(1, 50_000_00));
      }

      const entries = ledger.entries();
      const added = entries.slice(before.length);
      // Append-only: every earlier entry is still there, the very same frozen object.
      expect(entries.length).toBeGreaterThanOrEqual(before.length);
      expect(before.every((e, i) => entries[i] === e)).toBe(true);
      // Available cash never goes negative, and blocked cash never drops below zero.
      expect(ledger.available).toBeGreaterThanOrEqual(0);
      expect(ledger.blocked).toBeGreaterThanOrEqual(0);
      expect(added.every((e) => e.balanceAfter >= 0)).toBe(true);
      // The ledger sum always equals the balance it reports.
      runningSum += sum(added);
      expect(runningSum).toBe(entries.at(-1)?.balanceAfter);
      expect(runningSum).toBe(ledger.available);
      expect(ledger.balance).toBe(ledger.available + ledger.blocked);
      expect(ledger.blocked).toBe(open.reduce((t, id) => t + ledger.blockedFor(id), 0));
      expect(FundsSummary.safeParse(ledger.summary()).success).toBe(true);
      before = entries;
    }

    // The running sum is checked against a full recomputation once at the end.
    expect(sum(ledger.entries())).toBe(ledger.available);

    expect(refusals).toBeGreaterThan(0);
    for (const e of ledger.entries()) expect(LedgerEntry.parse(e)).toEqual(e);
    expect(new Set(ledger.entries().map((e) => e.id)).size).toBe(ledger.entries().length);
  });
});

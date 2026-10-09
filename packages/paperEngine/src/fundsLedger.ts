import {
  LedgerEntry,
  PAPER_OPENING_BALANCE_PAISE,
  type FundsSummary,
  type LedgerEntryType,
} from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import { assertPaise, assertPositivePaise, type EngineContext } from './context.js';

export type LedgerResult =
  | { ok: true; entries: readonly LedgerEntry[] }
  | { ok: false; code: 'INSUFFICIENT_FUNDS'; reason: string };

/**
 * What a ledger carries in from entries it no longer holds (T-199): the available cash after the
 * last of them and the cash still blocked per order. Paired with the entries that came after.
 */
export type LedgerCarried = {
  available: number;
  blocks: readonly (readonly [orderId: string, amount: number])[];
};

export type FundsLedgerOptions = {
  /** Defaults to ₹10,00,000 (`PAPER_OPENING_BALANCE_PAISE`). */
  openingBalance?: number;
  /**
   * Entries of a saved ledger (`entries()` of an earlier one) to carry on from instead of a fresh
   * opening credit. Replayed and checked: each must be a valid `LedgerEntry`, the first the
   * `OPENING_CREDIT` of `openingBalance`, and every `balanceAfter` must add up.
   */
  entries?: readonly LedgerEntry[];
  /**
   * With `carried`, `entries` are only the entries after it (a working set, T-199): they need not
   * start with the opening credit, and `entries()` and `size` cover just those.
   */
  carried?: LedgerCarried;
};

/**
 * The paper-trading funds ledger (ADR 0004). All amounts are integer paise.
 *
 * Every change is an append-only entry with a signed `amount` and `balanceAfter`, the available
 * cash after it (the `LedgerEntry` contract). So the sum of all amounts always equals available
 * cash, and `balance` = available + blocked.
 *
 * - Opening: `OPENING_CREDIT` of ₹10,00,000.
 * - Place a BUY: `block()` moves cash from available to blocked (`ORDER_BLOCK`).
 * - Cancel: `release()` moves the order's remaining block back (`ORDER_RELEASE`).
 * - Fill: `settleBuy()` releases the block and debits the trade value (`TRADE_DEBIT`);
 *   `settleSell()` credits the proceeds (`TRADE_CREDIT`).
 *
 * - Reset (T-155): `reset()` brings available cash back to the opening balance with one `RESET`
 *   entry, once every order's block is released. Earlier entries stay: the ledger never shrinks.
 *
 * Available cash never goes negative: an operation that would overdraw returns
 * `INSUFFICIENT_FUNDS` and appends nothing. The one exception is `settleForcedBuy()`, the
 * automatic intraday square-off.
 */
export class FundsLedger {
  readonly openingBalance: number;
  readonly #ctx: Pick<EngineContext, 'nowIso' | 'nextId'>;
  readonly #entries: LedgerEntry[] = [];
  readonly #blocks = new Map<string, number>();
  /** The balance the held entries start from; empty when they start at the opening credit. */
  #base: LedgerCarried = { available: 0, blocks: [] };
  #available = 0;
  #blocked = 0;

  constructor(ctx: Pick<EngineContext, 'nowIso' | 'nextId'>, options: FundsLedgerOptions = {}) {
    this.#ctx = ctx;
    this.openingBalance = options.openingBalance ?? PAPER_OPENING_BALANCE_PAISE;
    assertPaise(this.openingBalance, 'Opening balance');
    if (this.openingBalance < 0) throw new RangeError('Opening balance must not be negative');
    if (options.carried) this.#carryIn(options.carried);
    if (options.entries) this.#replay(options.entries, options.carried !== undefined);
    else if (options.carried) throw new RangeError('A carried balance needs its entries');
    else this.#append('OPENING_CREDIT', this.openingBalance, null, 'Opening paper balance');
  }

  /** Cash free to trade with. */
  get available(): number {
    return this.#available;
  }

  /** Cash held against open BUY orders. */
  get blocked(): number {
    return this.#blocked;
  }

  /** Available plus blocked. */
  get balance(): number {
    return this.#available + this.#blocked;
  }

  /** Cash still blocked for one order (0 if none). */
  blockedFor(orderId: string): number {
    return this.#blocks.get(orderId) ?? 0;
  }

  /** Every entry in order. The entries are frozen; the ledger is append-only. */
  entries(): readonly LedgerEntry[] {
    return [...this.#entries];
  }

  /** How many entries there are. */
  get size(): number {
    return this.#entries.length;
  }

  /** The entries from position `start` on (0-based), without copying the whole ledger. */
  entriesFrom(start: number): readonly LedgerEntry[] {
    return this.#entries.slice(Math.max(0, start));
  }

  /**
   * Resets the paper balance (T-155): appends one `RESET` entry whose amount brings available
   * cash back to the opening balance (it may be zero or negative when the account is up). Every
   * block must be released first (the engine cancels open orders before it resets).
   */
  reset(): LedgerResult {
    if (this.#blocked !== 0) {
      throw new Error('Release every blocked amount before a reset');
    }
    const amount = this.openingBalance - this.#available;
    return this.#ok(
      this.#append(
        'RESET',
        amount,
        null,
        `Paper balance reset to ${formatInr(this.openingBalance)}`,
      ),
    );
  }

  /** Blocks `amount` for a BUY order being placed. An order may be blocked more than once (modify). */
  block(orderId: string, amount: number): LedgerResult {
    assertPositivePaise(amount, 'Block amount');
    if (amount > this.#available) return insufficient(amount, this.#available);
    this.#blocks.set(orderId, this.blockedFor(orderId) + amount);
    this.#blocked += amount;
    return this.#ok(this.#append('ORDER_BLOCK', -amount, orderId, `Blocked for order ${orderId}`));
  }

  /**
   * Releases `amount` (default: all) of an order's block, for a cancel or a downward modify.
   * Releasing an order with nothing blocked appends nothing.
   */
  release(orderId: string, amount?: number): LedgerResult {
    const toRelease = this.#releasable(orderId, amount);
    return this.#ok(...this.#releaseEntry(orderId, toRelease));
  }

  /**
   * Settles a BUY fill: releases `release` (default: the order's whole block) and debits `cost`,
   * the trade value in paise. Refused, with nothing appended, if the cash would not cover it.
   */
  settleBuy(orderId: string, cost: number, release?: number): LedgerResult {
    assertPositivePaise(cost, 'Trade value');
    const toRelease = this.#releasable(orderId, release);
    if (cost > this.#available + toRelease) {
      return insufficient(cost, this.#available + toRelease);
    }
    const released = this.#releaseEntry(orderId, toRelease);
    const debit = this.#append('TRADE_DEBIT', -cost, orderId, `Bought under order ${orderId}`);
    return this.#ok(...released, debit);
  }

  /**
   * Settles the automatic 15:20 IST buy-back of an intraday short (T-130). Like a broker's auto
   * square-off it always goes through, so it is the one operation that may take available cash
   * below zero; the funds summary then shows the debit balance. Releases any block the order has.
   */
  settleForcedBuy(orderId: string, cost: number): LedgerResult {
    assertPositivePaise(cost, 'Trade value');
    const released = this.#releaseEntry(orderId, this.blockedFor(orderId));
    const debit = this.#append('TRADE_DEBIT', -cost, orderId, `Bought under order ${orderId}`);
    return this.#ok(...released, debit);
  }

  /** Settles a SELL fill: credits `proceeds`, the trade value in paise. */
  settleSell(orderId: string, proceeds: number): LedgerResult {
    assertPositivePaise(proceeds, 'Trade value');
    return this.#ok(this.#append('TRADE_CREDIT', proceeds, orderId, `Sold under order ${orderId}`));
  }

  /** The funds summary contract. Realised P&L comes from the position math, not the ledger. */
  summary(realisedPnlToday = 0): FundsSummary {
    assertPaise(realisedPnlToday, 'Realised P&L');
    return {
      openingBalance: this.openingBalance,
      balance: this.balance,
      blocked: this.#blocked,
      available: this.#available,
      realisedPnlToday,
      asOf: this.#ctx.nowIso(),
    };
  }

  /**
   * The ledger as a carried balance plus the entries created at or after `since` (ISO UTC), which
   * is what a working-set snapshot keeps (T-199). Restoring it gives the same balances and blocks.
   */
  workingSet(since: string): { carried: LedgerCarried; entries: LedgerEntry[] } {
    let available = this.#base.available;
    const blocks = new Map(this.#base.blocks);
    let split = 0;
    for (const entry of this.#entries) {
      if (entry.createdAt >= since) break;
      available += entry.amount;
      if ((entry.type === 'ORDER_BLOCK' || entry.type === 'ORDER_RELEASE') && entry.orderId) {
        const held = (blocks.get(entry.orderId) ?? 0) - entry.amount;
        if (held === 0) blocks.delete(entry.orderId);
        else blocks.set(entry.orderId, held);
      }
      split += 1;
    }
    return {
      carried: { available, blocks: [...blocks] },
      entries: this.#entries.slice(split).map((entry) => ({ ...entry })),
    };
  }

  #carryIn(carried: LedgerCarried): void {
    assertPaise(carried.available, 'Carried balance');
    let blocked = 0;
    for (const [orderId, amount] of carried.blocks) {
      assertPositivePaise(amount, 'Carried block');
      if (this.#blocks.has(orderId)) throw new RangeError(`Carried block repeats order ${orderId}`);
      this.#blocks.set(orderId, amount);
      blocked += amount;
    }
    this.#available = carried.available;
    this.#blocked = blocked;
    this.#base = { available: carried.available, blocks: carried.blocks.map(([id, n]) => [id, n]) };
  }

  /** Rebuilds balances and per-order blocks from saved entries (see `FundsLedgerOptions.entries`). */
  #replay(entries: readonly LedgerEntry[], carried: boolean): void {
    const [first] = entries;
    if (!carried && (first?.type !== 'OPENING_CREDIT' || first.amount !== this.openingBalance)) {
      throw new RangeError('A saved ledger must start with its opening credit');
    }
    for (const raw of entries) {
      const entry = LedgerEntry.parse(raw);
      this.#available += entry.amount;
      if (entry.balanceAfter !== this.#available) {
        throw new RangeError(`Saved ledger entry ${entry.id} does not add up`);
      }
      if (entry.type === 'ORDER_BLOCK' || entry.type === 'ORDER_RELEASE') {
        if (entry.orderId === null) throw new RangeError(`Ledger entry ${entry.id} has no order`);
        const held = this.blockedFor(entry.orderId) - entry.amount;
        if (held < 0) throw new RangeError(`Ledger entry ${entry.id} releases more than blocked`);
        if (held === 0) this.#blocks.delete(entry.orderId);
        else this.#blocks.set(entry.orderId, held);
        this.#blocked -= entry.amount;
      }
      this.#entries.push(Object.freeze(entry));
    }
  }

  #releasable(orderId: string, amount: number | undefined): number {
    const held = this.blockedFor(orderId);
    if (amount === undefined) return held;
    assertPaise(amount, 'Release amount');
    if (amount < 0 || amount > held) {
      throw new RangeError(
        `Cannot release ${String(amount)} paise for order ${orderId}; ${String(held)} is blocked`,
      );
    }
    return amount;
  }

  #releaseEntry(orderId: string, amount: number): LedgerEntry[] {
    if (amount === 0) return [];
    const left = this.blockedFor(orderId) - amount;
    if (left === 0) this.#blocks.delete(orderId);
    else this.#blocks.set(orderId, left);
    this.#blocked -= amount;
    return [this.#append('ORDER_RELEASE', amount, orderId, `Released from order ${orderId}`)];
  }

  #append(
    type: LedgerEntryType,
    amount: number,
    orderId: string | null,
    description: string,
  ): LedgerEntry {
    this.#available += amount;
    const entry: LedgerEntry = Object.freeze({
      id: this.#ctx.nextId(),
      type,
      amount,
      balanceAfter: this.#available,
      orderId,
      description,
      createdAt: this.#ctx.nowIso(),
    });
    this.#entries.push(entry);
    return entry;
  }

  #ok(...entries: LedgerEntry[]): LedgerResult {
    return { ok: true, entries };
  }
}

function insufficient(needed: number, available: number): LedgerResult {
  return {
    ok: false,
    code: 'INSUFFICIENT_FUNDS',
    reason: `Not enough cash: this needs ${formatInr(needed)} and ${formatInr(available)} is available`,
  };
}

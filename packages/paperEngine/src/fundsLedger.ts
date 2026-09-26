import {
  PAPER_OPENING_BALANCE_PAISE,
  type FundsSummary,
  type LedgerEntry,
  type LedgerEntryType,
} from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import { assertPaise, assertPositivePaise, type EngineContext } from './context.js';

export type LedgerResult =
  | { ok: true; entries: readonly LedgerEntry[] }
  | { ok: false; code: 'INSUFFICIENT_FUNDS'; reason: string };

export type FundsLedgerOptions = {
  /** Defaults to ₹10,00,000 (`PAPER_OPENING_BALANCE_PAISE`). */
  openingBalance?: number;
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
 * Available cash never goes negative: an operation that would overdraw returns
 * `INSUFFICIENT_FUNDS` and appends nothing.
 */
export class FundsLedger {
  readonly openingBalance: number;
  readonly #ctx: Pick<EngineContext, 'nowIso' | 'nextId'>;
  readonly #entries: LedgerEntry[] = [];
  readonly #blocks = new Map<string, number>();
  #available = 0;
  #blocked = 0;

  constructor(ctx: Pick<EngineContext, 'nowIso' | 'nextId'>, options: FundsLedgerOptions = {}) {
    this.#ctx = ctx;
    this.openingBalance = options.openingBalance ?? PAPER_OPENING_BALANCE_PAISE;
    assertPaise(this.openingBalance, 'Opening balance');
    if (this.openingBalance < 0) throw new RangeError('Opening balance must not be negative');
    this.#append('OPENING_CREDIT', this.openingBalance, null, 'Opening paper balance');
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

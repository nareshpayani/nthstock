import type { OrderSide } from '@nthstock/contracts';
import { assertPaise, assertPositivePaise, assertQty } from './context.js';

/** One fill: `qty` shares at `price` paise. */
export type Trade = {
  side: OrderSide;
  qty: number;
  price: number;
};

/**
 * Running totals for one instrument and product. All money is integer paise.
 *
 * `openCost` is what the open quantity cost (for a short, what it was sold for). It is kept as an
 * exact integer instead of an average price, so no paise are lost to rounding: closing part of a
 * position removes a proportional, rounded share of it, and closing the rest removes exactly what
 * is left.
 */
export type PositionBook = {
  /** Signed: negative for an intraday short. */
  netQty: number;
  openCost: number;
  buyQty: number;
  sellQty: number;
  /** Sum of qty × price over every BUY fill. */
  buyValue: number;
  /** Sum of qty × price over every SELL fill. */
  sellValue: number;
  realisedPnl: number;
};

export const EMPTY_POSITION: PositionBook = Object.freeze({
  netQty: 0,
  openCost: 0,
  buyQty: 0,
  sellQty: 0,
  buyValue: 0,
  sellValue: 0,
  realisedPnl: 0,
});

/**
 * `a × b ÷ c` rounded half away from zero, exact for any safe-integer inputs (BigInt inside, so
 * `a × b` may exceed 2^53). `c` must be positive.
 */
export function mulDivRound(a: number, b: number, c: number): number {
  assertPaise(a, 'mulDivRound a');
  assertPaise(b, 'mulDivRound b');
  assertPositivePaise(c, 'mulDivRound divisor');
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  let q = n / d;
  const r = n % d;
  if (2n * (r < 0n ? -r : r) >= d) q += n < 0n ? -1n : 1n;
  return Number(q);
}

function value(qty: number, price: number): number {
  const v = qty * price;
  assertPaise(v, 'Trade value');
  return v;
}

/**
 * Applies one fill to a position and returns the new position (the input is not changed).
 * Trades in the direction of the position (or from flat) add to it at a weighted average cost;
 * trades against it close quantity and book realised P&L; a trade larger than the open quantity
 * closes it and opens the rest on the other side.
 */
export function applyTrade(book: PositionBook, trade: Trade): PositionBook {
  assertQty(trade.qty, 'Trade quantity');
  assertPositivePaise(trade.price, 'Trade price');
  const direction = trade.side === 'BUY' ? 1 : -1;
  const next: PositionBook = {
    ...book,
    buyQty: book.buyQty + (direction === 1 ? trade.qty : 0),
    sellQty: book.sellQty + (direction === -1 ? trade.qty : 0),
    buyValue: book.buyValue + (direction === 1 ? value(trade.qty, trade.price) : 0),
    sellValue: book.sellValue + (direction === -1 ? value(trade.qty, trade.price) : 0),
  };

  const openQty = Math.abs(book.netQty);
  const adding = book.netQty === 0 || Math.sign(book.netQty) === direction;
  if (adding) {
    next.netQty = book.netQty + direction * trade.qty;
    next.openCost = book.openCost + value(trade.qty, trade.price);
    return next;
  }

  const closeQty = Math.min(trade.qty, openQty);
  const removedCost = mulDivRound(book.openCost, closeQty, openQty);
  const closeValue = value(closeQty, trade.price);
  // Long: sold for closeValue what cost removedCost. Short: bought back for closeValue what sold for removedCost.
  next.realisedPnl =
    book.realisedPnl + (book.netQty > 0 ? closeValue - removedCost : removedCost - closeValue);
  next.netQty = book.netQty + direction * closeQty;
  next.openCost = book.openCost - removedCost;

  const rest = trade.qty - closeQty;
  if (rest > 0) {
    next.netQty += direction * rest;
    next.openCost = value(rest, trade.price);
  }
  return next;
}

/** Applies fills in order, starting from `from` (default: flat). */
export function applyTrades(
  trades: readonly Trade[],
  from: PositionBook = EMPTY_POSITION,
): PositionBook {
  return trades.reduce(applyTrade, from);
}

/** Weighted average cost of the open quantity, rounded to the paisa; 0 when flat. */
export function averagePrice(book: PositionBook): number {
  return book.netQty === 0 ? 0 : mulDivRound(book.openCost, 1, Math.abs(book.netQty));
}

/** Mark-to-market P&L of the open quantity at `ltp`. */
export function unrealisedPnl(book: PositionBook, ltp: number): number {
  assertPositivePaise(ltp, 'LTP');
  if (book.netQty === 0) return 0;
  const marketValue = value(Math.abs(book.netQty), ltp);
  return book.netQty > 0 ? marketValue - book.openCost : book.openCost - marketValue;
}

/** The numbers behind a `Position` (contracts), for today's trades in one instrument and product. */
export type PositionValues = {
  netQty: number;
  buyQty: number;
  sellQty: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  /** Weighted average cost of the open quantity. */
  avgPrice: number;
  ltp: number;
  realisedPnl: number;
  unrealisedPnl: number;
  /** A position is opened today, so its day's P&L is realised plus unrealised. */
  dayPnl: number;
};

export function positionValues(book: PositionBook, ltp: number): PositionValues {
  const unrealised = unrealisedPnl(book, ltp);
  return {
    netQty: book.netQty,
    buyQty: book.buyQty,
    sellQty: book.sellQty,
    avgBuyPrice: book.buyQty === 0 ? 0 : mulDivRound(book.buyValue, 1, book.buyQty),
    avgSellPrice: book.sellQty === 0 ? 0 : mulDivRound(book.sellValue, 1, book.sellQty),
    avgPrice: averagePrice(book),
    ltp,
    realisedPnl: book.realisedPnl,
    unrealisedPnl: unrealised,
    dayPnl: book.realisedPnl + unrealised,
  };
}

/** A delivery holding carried across days: quantity and what it cost in total. */
export type HoldingLot = {
  qty: number;
  investedValue: number;
};

/** The numbers behind a `Holding` (contracts). Percentages are integer basis points. */
export type HoldingValues = {
  qty: number;
  avgPrice: number;
  ltp: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlBp: number;
  /** Day's P&L: qty × (LTP − previous close). */
  dayChange: number;
  dayChangeBp: number;
};

/** Percentage change of `change` over `base` in basis points, rounded; 0 when the base is 0. */
export function basisPoints(change: number, base: number): number {
  return base === 0 ? 0 : mulDivRound(change, 10_000, base);
}

export function holdingValues(lot: HoldingLot, ltp: number, prevClose: number): HoldingValues {
  assertQty(lot.qty, 'Holding quantity');
  assertPaise(lot.investedValue, 'Invested value');
  if (lot.investedValue < 0) throw new RangeError('Invested value must not be negative');
  assertPositivePaise(ltp, 'LTP');
  assertPositivePaise(prevClose, 'Previous close');
  const currentValue = value(lot.qty, ltp);
  const pnl = currentValue - lot.investedValue;
  const dayChange = value(lot.qty, ltp - prevClose);
  return {
    qty: lot.qty,
    avgPrice: mulDivRound(lot.investedValue, 1, lot.qty),
    ltp,
    investedValue: lot.investedValue,
    currentValue,
    pnl,
    pnlBp: basisPoints(pnl, lot.investedValue),
    dayChange,
    dayChangeBp: basisPoints(ltp - prevClose, prevClose),
  };
}

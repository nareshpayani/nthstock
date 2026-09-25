import type { DepthLevel } from '@nthstock/contracts';
import { DEPTH_LEVELS, TICK_SIZE_PAISE } from '@nthstock/contracts';
import { floorToTick } from './price.js';
import { randomInt, type Rng } from './prng.js';

export type DepthBook = {
  bids: DepthLevel[];
  asks: DepthLevel[];
  totalBidQty: number;
  totalAskQty: number;
};

/** Largest gap between neighbouring levels, in ticks. */
const MAX_STEP_TICKS = 2;

function level(rng: Rng, price: number, avgQty: number): DepthLevel {
  const qty = randomInt(rng, 1, Math.max(1, Math.round(avgQty * 2)));
  return { price, qty, orders: randomInt(rng, 1, Math.min(qty, 40)) };
}

/**
 * Top-5 bids and asks around the LTP: bids best (highest) first and strictly descending, asks best
 * (lowest) first and strictly ascending, best bid < best ask, all prices on the tick.
 */
export function generateDepth(
  ltp: number,
  rng: Rng,
  avgQty = 500,
  tick: number = TICK_SIZE_PAISE,
): DepthBook {
  // Keep every bid level positive even for a very low LTP.
  const minBestBid = (1 + (DEPTH_LEVELS - 1) * MAX_STEP_TICKS) * tick;
  const bestBid = Math.max(minBestBid, floorToTick(ltp, tick) - (rng() < 0.5 ? 0 : tick));
  const bestAsk = bestBid + randomInt(rng, 1, MAX_STEP_TICKS) * tick;

  const bids: DepthLevel[] = [];
  const asks: DepthLevel[] = [];
  let bid = bestBid;
  let ask = bestAsk;
  for (let i = 0; i < DEPTH_LEVELS; i += 1) {
    bids.push(level(rng, bid, avgQty));
    asks.push(level(rng, ask, avgQty));
    bid -= randomInt(rng, 1, MAX_STEP_TICKS) * tick;
    ask += randomInt(rng, 1, MAX_STEP_TICKS) * tick;
  }
  // Totals cover the whole book, not just the top five levels, so they read larger (as on NSE).
  const sum = (levels: DepthLevel[]) => levels.reduce((total, l) => total + l.qty, 0);
  return { bids, asks, totalBidQty: sum(bids) * 7, totalAskQty: sum(asks) * 7 };
}

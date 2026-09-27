import type { Depth } from '@nthstock/contracts';

/** Narrowest bar drawn for a level with any quantity, so a small level is still visible. */
export const MIN_BAR_PERCENT = 2;

/** The largest quantity across both sides: every bar is scaled against it, so sides compare. */
export function depthScale(depth: Pick<Depth, 'bids' | 'asks'>): number {
  let max = 0;
  for (const level of depth.bids) max = Math.max(max, level.qty);
  for (const level of depth.asks) max = Math.max(max, level.qty);
  return max;
}

/** A level's bar width as a whole percent of the largest quantity (0 for an empty level). */
export function barPercent(qty: number, maxQty: number): number {
  if (qty <= 0 || maxQty <= 0) return 0;
  return Math.max(MIN_BAR_PERCENT, Math.min(100, Math.round((qty * 100) / maxQty)));
}

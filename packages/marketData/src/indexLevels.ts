/** A constituent's weight (shares in the index) and its price in paise. */
export type WeightedPrice = { weight: number; price: number };

/** Σ weight × price: the index's aggregate market value. */
export function aggregateValue(constituents: readonly WeightedPrice[]): number {
  let total = 0;
  for (const c of constituents) total += c.weight * c.price;
  return total;
}

/**
 * Market-cap weighted index level: the base level scaled by how much the constituents' aggregate
 * value has moved since the base. Returns an integer in hundredths of a point (IndexSummary scale).
 */
export function computeIndexLevel(
  baseLevel: number,
  baseValue: number,
  constituents: readonly WeightedPrice[],
): number {
  if (baseValue <= 0) return baseLevel;
  return Math.round((baseLevel * aggregateValue(constituents)) / baseValue);
}

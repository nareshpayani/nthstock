/**
 * How far, in px, a price-axis tick label must sit from a tag's centre to stay drawn. A tag (the
 * live price, a position or a stop) is about 20 px tall and a label about 12, so anything nearer
 * than half of both, plus a little air, would be half covered (NSTOCK-0446).
 */
export const TAG_CLEARANCE_PX = 18;

/**
 * Which tick labels to draw: `false` for a label a tag would half cover, so the axis shows either
 * a whole label or the tag, never a sliver of one under the other. `y` maps a price to its pixel
 * row (null when off the scale); `tags` are the tags' pixel rows. The first and last labels always
 * show: the library sizes the axis from them, so hiding one would change the axis width and shift
 * the whole plot and its time axis as a tag moves.
 */
export function visibleTickLabels(
  prices: readonly number[],
  y: (price: number) => number | null,
  tags: readonly number[],
): boolean[] {
  return prices.map((price, i) => {
    if (i === 0 || i === prices.length - 1) return true;
    const row = y(price);
    return row === null || tags.every((tag) => Math.abs(tag - row) >= TAG_CLEARANCE_PX);
  });
}

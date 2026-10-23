/** Labels closer than this are offset with a leader line (SPEC-TFC-1 §8.4): one touch target. */
export const LABEL_GAP = 44;
/** A pinned label keeps this far from the pane's top and bottom edges, so it stays tappable. */
export const EDGE_INSET = 22;

export type LayoutInput = {
  id: string;
  /** Price in paise. */
  price: number;
};

export type HandleLayout = {
  id: string;
  /** Where the line is, in px from the top of the pane; null when it is off the visible range. */
  lineY: number | null;
  /** Where the label's centre goes; differs from `lineY` when offset or pinned. */
  labelY: number;
  /** Set when the line is off screen: the label sits on that edge with an arrow. */
  pinned: 'top' | 'bottom' | null;
};

export type LayoutOptions = {
  /** Height of the price pane in px. */
  height: number;
  gap?: number;
  inset?: number;
};

/**
 * Places each line's label for one repaint (SPEC-TFC-1 §8.4, §10.5). A line outside the pane pins
 * its label to the nearest edge; labels that would overlap are spread apart by `gap`, keeping
 * their order by price, and pulled back inside the pane if the spread runs past an edge. Pure and
 * allocation-light, because it runs on every chart repaint.
 */
export function layoutHandles(
  items: readonly LayoutInput[],
  toY: (price: number) => number | null,
  { height, gap = LABEL_GAP, inset = EDGE_INSET }: LayoutOptions,
): HandleLayout[] {
  const top = Math.min(inset, height / 2);
  const bottom = Math.max(height - inset, height / 2);
  const placed = items.map((item): HandleLayout => {
    const y = toY(item.price);
    if (y === null || !Number.isFinite(y)) {
      return { id: item.id, lineY: null, labelY: top, pinned: 'top' };
    }
    if (y < 0) return { id: item.id, lineY: null, labelY: top, pinned: 'top' };
    if (y > height) return { id: item.id, lineY: null, labelY: bottom, pinned: 'bottom' };
    return { id: item.id, lineY: y, labelY: Math.min(Math.max(y, top), bottom), pinned: null };
  });

  // Top to bottom by label position; ties keep the caller's order (its hit priority).
  const order = placed
    .map((_, index) => index)
    .sort((a, b) => {
      const delta = (placed[a]?.labelY ?? 0) - (placed[b]?.labelY ?? 0);
      return delta === 0 ? a - b : delta;
    });
  const at = (k: number) => placed[order[k] ?? 0] as HandleLayout;

  for (let k = 1; k < order.length; k += 1) {
    const above = at(k - 1);
    const here = at(k);
    if (here.labelY - above.labelY < gap) here.labelY = above.labelY + gap;
  }
  // Spread past the bottom: pull back up, never above the top inset.
  for (let k = order.length - 1; k >= 0; k -= 1) {
    const here = at(k);
    const limit = k === order.length - 1 ? bottom : at(k + 1).labelY - gap;
    if (here.labelY > limit) here.labelY = Math.max(limit, top);
  }
  return placed;
}

/** A price snapped to the instrument's tick (paise), never below one tick. */
export function snapToTick(price: number, tick: number): number {
  const step = tick > 0 ? tick : 1;
  return Math.max(step, Math.round(price / step) * step);
}

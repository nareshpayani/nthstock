import type { LoupeSpec } from './loupe';

/** The kinds of line the trading overlay draws (SPEC-TFC-1 §8.1). */
export type OverlayTone =
  'buy' | 'sell' | 'ghost' | 'position' | 'trailing' | 'activation' | 'pending';

/** A button beside a line's handle: × to cancel an order (§8.3), Buy and Sell on the ghost (§8.2). */
export type LineAction = {
  id: string;
  label: string;
  description: string;
  /** `armed` is a confirm step ("Cancel?"); `buy` and `sell` carry the side's colour and word. */
  look: 'plain' | 'armed' | 'buy' | 'sell';
};

export type OverlayLine = {
  id: string;
  /** Price in paise. */
  price: number;
  tone: OverlayTone;
  /** The handle's visible text, e.g. "Buy 10 @ ₹1,234.50". Colour is never the only signal. */
  label: string;
  /** The handle's accessible name, with what the keys do. */
  description: string;
  /** Whether the handle can be dragged (or moved with the arrow keys) to a new price. */
  draggable: boolean;
  /** Buttons beside the handle, in order. */
  actions?: readonly LineAction[] | undefined;
  /** What the loupe works out while the line is dragged; price and distance only without it. */
  loupe?: LoupeSpec | undefined;
};

/**
 * Hit priority when handles overlap (§8.4): the active drag first, then orders, then the trailing
 * stop, then the position. Lower wins; the ghost sits with orders.
 */
const TONE_PRIORITY: Record<OverlayTone, number> = {
  pending: 0,
  buy: 1,
  sell: 1,
  ghost: 1,
  trailing: 2,
  activation: 2,
  position: 3,
};

/** Lines in hit-priority order, stable for equal priority. */
export const byPriority = (lines: readonly OverlayLine[]): OverlayLine[] =>
  [...lines].sort((a, b) => TONE_PRIORITY[a.tone] - TONE_PRIORITY[b.tone]);

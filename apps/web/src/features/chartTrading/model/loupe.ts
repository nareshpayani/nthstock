import { formatInr } from '@nthstock/utils';
import { signedInr } from '@/shared/components/PnlAmount';
import { strings } from '../strings';

/**
 * What the loupe works out for a held line (SPEC-CR-1 §4.2): an order's value at the new price,
 * or what a stop would make or lose against the position's average. Without one the loupe shows
 * the price and its distance from the LTP only.
 */
export type LoupeSpec =
  | { kind: 'value'; qty: number }
  | { kind: 'pnl'; /** Signed: negative for a short. */ qty: number; avgPrice: number };

export type LoupeText = { price: string; distance: string | null; detail: string | null };

const MINUS = '−';

/** The loupe's three lines for a line held at `price`. */
export function loupeText(price: number, ltp: number | undefined, spec?: LoupeSpec): LoupeText {
  let distance: string | null = null;
  if (ltp !== undefined && ltp > 0) {
    const percent = ((price - ltp) / ltp) * 100;
    const rounded = Math.round(percent * 100) / 100;
    distance =
      rounded === 0
        ? strings.loupe.atLtp
        : strings.loupe.fromLtp(`${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(2)}%`);
  }
  let detail: string | null = null;
  if (spec?.kind === 'value') {
    detail = strings.loupe.value(
      String(spec.qty),
      formatInr(price),
      formatInr(Math.round(spec.qty * price)),
    );
  } else if (spec?.kind === 'pnl') {
    const pnl = Math.round((price - spec.avgPrice) * spec.qty);
    detail = strings.loupe.pnl(signedInr(pnl).replace('-', MINUS));
  }
  return { price: formatInr(price), distance, detail };
}

/** Clear space between the loupe and the finger, so the thumb never hides it. */
export const LOUPE_GAP = 56;
/** The loupe keeps this far inside the chart's edges. */
export const LOUPE_INSET = 8;

export type LoupePlacement = { left: number; top: number; side: 'left' | 'right' };

/**
 * Where the loupe goes for a finger at (x, y) in a `width` × `height` chart (CR-T07, AC-03): above
 * the finger, on the left of it at or above the LTP and on the right below it, so it flips as the
 * line crosses the LTP. A side that would run off the chart flips, and the card is then clamped
 * inside, so it is always whole on screen. Below the finger when there is no room above.
 */
export function placeLoupe({
  x,
  y,
  width,
  height,
  cardWidth,
  cardHeight,
  aboveLtp,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  cardWidth: number;
  cardHeight: number;
  aboveLtp: boolean;
}): LoupePlacement {
  const leftOf = x - LOUPE_GAP / 2 - cardWidth;
  const rightOf = x + LOUPE_GAP / 2;
  const fitsLeft = leftOf >= LOUPE_INSET;
  const fitsRight = rightOf + cardWidth <= width - LOUPE_INSET;
  let side: LoupePlacement['side'] = aboveLtp ? 'left' : 'right';
  if (side === 'left' && !fitsLeft && fitsRight) side = 'right';
  else if (side === 'right' && !fitsRight && fitsLeft) side = 'left';
  const left = clamp(
    side === 'left' ? leftOf : rightOf,
    LOUPE_INSET,
    width - LOUPE_INSET - cardWidth,
  );
  const above = y - LOUPE_GAP - cardHeight;
  const top = clamp(
    above >= LOUPE_INSET ? above : y + LOUPE_GAP,
    LOUPE_INSET,
    height - LOUPE_INSET - cardHeight,
  );
  return { left, top, side };
}

// When the card is wider than the chart, the near edge wins: it starts at the inset.
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

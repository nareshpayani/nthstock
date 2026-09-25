/**
 * Percentages are passed as integer basis points (1.25% = 125) so callers never round floats.
 * Direction is always carried in text too (▲ ▼), never by colour alone (CLAUDE.md §6).
 */

export type ChangeDirection = 'up' | 'down' | 'flat';

export type FormattedChange = {
  /** Visible text, e.g. "▲ 1.25%". */
  text: string;
  direction: ChangeDirection;
  /** Text for screen readers, e.g. "up 1.25 percent". */
  srLabel: string;
};

function assertBasisPoints(basisPoints: number): void {
  if (!Number.isSafeInteger(basisPoints)) {
    throw new RangeError(`Expected integer basis points, got ${String(basisPoints)}`);
  }
}

/** 125 → "1.25%", -50 → "-0.50%". */
export function formatPct(basisPoints: number): string {
  assertBasisPoints(basisPoints);
  const sign = basisPoints < 0 ? '-' : '';
  const abs = Math.abs(basisPoints);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}%`;
}

/** 125 → { text: "▲ 1.25%", direction: "up", srLabel: "up 1.25 percent" }. */
export function formatChange(basisPoints: number): FormattedChange {
  const magnitude = formatPct(Math.abs(basisPoints));
  const number = magnitude.slice(0, -1);
  if (basisPoints > 0)
    return { text: `▲ ${magnitude}`, direction: 'up', srLabel: `up ${number} percent` };
  if (basisPoints < 0)
    return { text: `▼ ${magnitude}`, direction: 'down', srLabel: `down ${number} percent` };
  return { text: `● ${magnitude}`, direction: 'flat', srLabel: 'unchanged' };
}

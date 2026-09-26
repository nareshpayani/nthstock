import { formatPct } from '@nthstock/utils';

const countFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Shares traded, en-IN grouped: 12345678 → "1,23,45,678". */
export function formatCount(count: number): string {
  return countFormat.format(count);
}

/** A ratio stored ×100 as an integer (P/E 24.53 → 2453) back to "24.53", without floats. */
export function formatX100(value: number): string {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`Expected an integer, got ${String(value)}`);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${countFormat.format(Math.trunc(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}

/** Dividend yield in basis points: 135 → "1.35%". */
export const formatYield = (basisPoints: number): string => formatPct(basisPoints);

/**
 * Where `value` sits between `low` and `high`, as a whole percent 0–100 for a range bar's marker.
 * A flat range (low = high) puts the marker in the middle.
 */
export function rangePercent(low: number, high: number, value: number): number {
  if (high <= low) return 50;
  const clamped = Math.min(Math.max(value, low), high);
  return Math.round(((clamped - low) * 100) / (high - low));
}

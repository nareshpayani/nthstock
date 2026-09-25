import { formatChange } from '@nthstock/utils';
import { cn } from '../lib/cn.js';

const grouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Index level in hundredths (2541860 → "25,418.60"), integer maths only. */
export function formatIndexLevel(hundredths: number): string {
  if (!Number.isSafeInteger(hundredths)) throw new RangeError('Expected integer hundredths');
  const sign = hundredths < 0 ? '-' : '';
  const abs = Math.abs(hundredths);
  return `${sign}${grouping.format(Math.trunc(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}

export type IndexTickerProps = {
  /** Display name, e.g. "NIFTY 50". */
  name: string;
  /** Level in hundredths of a point. */
  level: number;
  /** Change from previous close in hundredths of a point. */
  change: number;
  /** Change in basis points (0.84% = 84). */
  changeBasisPoints: number;
  /** Show only the percent change (tight headers); the full change stays in the spoken text. */
  compact?: boolean;
  className?: string;
};

/**
 * One index in the header: name, level and change with ▲▼, text and colour. The whole ticker reads
 * as one phrase for screen readers ("NIFTY 50 25,418.60, up 212.45 points, up 0.84 percent").
 */
export function IndexTicker({
  name,
  level,
  change,
  changeBasisPoints,
  compact = false,
  className,
}: IndexTickerProps) {
  const pct = formatChange(changeBasisPoints);
  const points = formatIndexLevel(Math.abs(change));
  const signed = `${change > 0 ? '+' : change < 0 ? '-' : ''}${points}`;
  const tone =
    pct.direction === 'up' ? 'text-up' : pct.direction === 'down' ? 'text-down' : 'text-ink-muted';
  const spokenPoints = pct.direction === 'flat' ? 'unchanged' : `${pct.direction} ${points} points`;
  return (
    <div
      className={cn('relative flex items-baseline gap-2 whitespace-nowrap', className)}
      data-direction={pct.direction}
    >
      <span className="sr-only">{`${name} ${formatIndexLevel(level)}, ${spokenPoints}, ${pct.srLabel}`}</span>
      <span aria-hidden="true" className="text-label font-semibold text-ink-muted">
        {name}
      </span>
      <span aria-hidden="true" className="font-mono text-body font-medium text-ink tabular-nums">
        {formatIndexLevel(level)}
      </span>
      <span aria-hidden="true" className={cn('font-mono text-label tabular-nums', tone)}>
        {compact ? pct.text : `${signed} (${pct.text})`}
      </span>
    </div>
  );
}

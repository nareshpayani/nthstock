import { cn } from '@nthstock/ui';
import { formatChange, formatInr, formatPct } from '@nthstock/utils';

export type PnlAmountProps = {
  /** Profit (positive) or loss (negative) in paise. */
  value: number;
  /** The same as a percentage, in integer basis points; shown after the amount when given. */
  basisPoints?: number | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const sizes = { sm: 'text-label', md: 'text-body', lg: 'text-title' } as const;
const tones = { up: 'text-up', down: 'text-down', flat: 'text-ink-muted' } as const;

/** "+₹1,234.50" / "-₹12.30" / "₹0.00": the sign is always in the text. */
export function signedInr(paise: number): string {
  return paise > 0 ? `+${formatInr(paise)}` : formatInr(paise);
}

/**
 * A profit or loss in paise: ▲ or ▼, the signed amount with lakh/crore grouping, optionally the
 * percentage, and the up/down colour, with a spoken label ("profit ₹1,234.50, up 1.25 percent"),
 * so the direction never relies on colour alone (CLAUDE.md §6).
 */
export function PnlAmount({ value, basisPoints, size = 'md', className }: PnlAmountProps) {
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '●';
  const percent = basisPoints === undefined ? '' : ` (${formatPct(basisPoints)})`;
  const word = direction === 'up' ? 'profit' : direction === 'down' ? 'loss' : 'no profit or loss';
  const spokenAmount = direction === 'flat' ? '' : ` ${formatInr(Math.abs(value))}`;
  const spokenPercent =
    basisPoints === undefined || direction === 'flat'
      ? ''
      : `, ${formatChange(basisPoints).srLabel}`;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono font-medium whitespace-nowrap tabular-nums',
        sizes[size],
        tones[direction],
        className,
      )}
      data-direction={direction}
    >
      <span aria-hidden="true">{`${arrow} ${signedInr(value)}${percent}`}</span>
      <span className="sr-only">{`${word}${spokenAmount}${spokenPercent}`}</span>
    </span>
  );
}

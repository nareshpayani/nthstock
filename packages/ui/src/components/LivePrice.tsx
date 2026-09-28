import { formatInr } from '@nthstock/utils';
import { cn } from '../lib/cn.js';
import { formatIndexLevel } from './IndexTicker.js';

export type LivePriceTick = 'up' | 'down' | 'flat';

export type LivePriceProps = {
  /** Price in paise, or an index level in hundredths of a point (see `format`). */
  value: number;
  /** Direction of the last change. Drives the ▲▼ marker. */
  tick: LivePriceTick;
  /** `inr` → "₹1,512.35"; `index` → "25,418.60". */
  format?: 'inr' | 'index';
  size?: 'sm' | 'md' | 'lg';
  className?: string | undefined;
};

const sizeClass = { sm: 'text-label', md: 'text-body', lg: 'text-title' } as const;

/**
 * A live price (T-057). Presentational: the value comes in as props (apps/web's PriceCell reads
 * the quote store). The value updates in place with no background flash (the owner asked for none,
 * 2026-09-28); ▲ or ▼ in green or red shows the last direction, so colour is never the only signal.
 */
export function LivePrice({ value, tick, format = 'inr', size = 'md', className }: LivePriceProps) {
  const text = format === 'index' ? formatIndexLevel(value) : formatInr(value);
  return (
    <span
      data-tick={tick}
      className={cn(
        'inline-flex items-baseline gap-1 rounded-sm px-1 font-mono font-medium whitespace-nowrap text-ink tabular-nums',
        sizeClass[size],
        className,
      )}
    >
      {text}
      <span
        aria-hidden="true"
        className={cn(
          'text-[0.75em]',
          tick === 'up' ? 'text-up' : tick === 'down' ? 'text-down' : 'invisible',
        )}
      >
        {tick === 'down' ? '▼' : '▲'}
      </span>
    </span>
  );
}

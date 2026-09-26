import { formatInr } from '@nthstock/utils';
import { cn } from '../lib/cn.js';
import { formatIndexLevel } from './IndexTicker.js';

export type LivePriceTick = 'up' | 'down' | 'flat';

export type LivePriceProps = {
  /** Price in paise, or an index level in hundredths of a point (see `format`). */
  value: number;
  /** Direction of the last change. Drives the flash and the ▲▼ marker. */
  tick: LivePriceTick;
  /**
   * Increments on every change. Each new value restarts the flash; the parity picks one of two
   * identical animations, so the browser replays it without remounting anything.
   */
  seq: number;
  /** `inr` → "₹1,512.35"; `index` → "25,418.60". */
  format?: 'inr' | 'index';
  size?: 'sm' | 'md' | 'lg';
  className?: string | undefined;
};

const flashClass = {
  up: ['animate-flash-up-a', 'animate-flash-up-b'],
  down: ['animate-flash-down-a', 'animate-flash-down-b'],
} as const;

const sizeClass = { sm: 'text-label', md: 'text-body', lg: 'text-title' } as const;

/**
 * A live price (T-057). Presentational: the value comes in as props (apps/web's PriceCell reads
 * the quote store). A change flashes the background green or red with CSS only, and ▲ or ▼ shows
 * the direction as a shape too, so colour is never the only signal. The flash is skipped under
 * prefers-reduced-motion; the arrow stays.
 */
export function LivePrice({
  value,
  tick,
  seq,
  format = 'inr',
  size = 'md',
  className,
}: LivePriceProps) {
  const text = format === 'index' ? formatIndexLevel(value) : formatInr(value);
  const flash = tick === 'flat' || seq === 0 ? undefined : flashClass[tick][seq % 2];
  return (
    <span
      data-tick={tick}
      className={cn(
        'inline-flex items-baseline gap-1 rounded-sm px-1 font-mono font-medium whitespace-nowrap text-ink tabular-nums motion-reduce:animate-none',
        sizeClass[size],
        flash,
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

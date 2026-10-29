import type { Exchange } from '@nthstock/contracts';
import { LivePrice, Skeleton, cn } from '@nthstock/ui';
import { memo } from 'react';
import { useQuote } from '@/shared/hooks/useQuote';

export type PriceCellProps = {
  symbol: string;
  exchange?: Exchange;
  /** `index` for index levels (hundredths of a point), `inr` for prices in paise. */
  format?: 'inr' | 'index';
  size?: 'sm' | 'md' | 'lg';
  /** Roll the changed digits on each tick (SPEC-CR-1 §5.6). */
  roll?: boolean;
  /** Price from a REST snapshot, shown until the first live quote arrives. */
  initial?: number | undefined;
  className?: string;
};

/** Skeleton height = LivePrice's line height per size (label 16, body 20, title 28 px): no shift. */
const skeletonHeight = { sm: 'h-4', md: 'h-5', lg: 'h-7' } as const;
/** About the width of a typical price at each size, so the value replacing it barely reflows. */
const skeletonWidth = { sm: 'w-16', md: 'w-20', lg: 'w-36' } as const;

/**
 * The only component that reads live prices (ADR 0005): subscribes one symbol and renders
 * LivePrice, with ▲ or ▼ for the day's direction (NSTOCK-0446). Memoised, so a parent re-render does not touch it and a tick re-renders only it.
 */
export const PriceCell = memo(function PriceCell({
  symbol,
  exchange = 'NSE',
  format = 'inr',
  size = 'md',
  roll = false,
  initial,
  className,
}: PriceCellProps) {
  const live = useQuote(symbol, exchange);
  if (!live && initial !== undefined) {
    return (
      <LivePrice
        value={initial}
        tick="flat"
        format={format}
        size={size}
        roll={roll}
        className={className}
      />
    );
  }
  if (!live) {
    return (
      <Skeleton
        className={cn(
          'inline-block align-middle',
          skeletonWidth[size],
          skeletonHeight[size],
          className,
        )}
      />
    );
  }
  // The marker follows the day's change, so it always agrees with the change badge beside it.
  const { change } = live.quote;
  return (
    <LivePrice
      value={live.quote.ltp}
      tick={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}
      format={format}
      size={size}
      roll={roll}
      className={className}
    />
  );
});

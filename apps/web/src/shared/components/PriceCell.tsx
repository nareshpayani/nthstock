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
  /** Price from a REST snapshot, shown (without a flash) until the first live quote arrives. */
  initial?: number | undefined;
  className?: string;
};

/** Skeleton height = LivePrice's line height per size (label 16, body 20, title 28 px): no shift. */
const skeletonHeight = { sm: 'h-4', md: 'h-5', lg: 'h-7' } as const;

/**
 * The only component that reads live prices (ADR 0005): subscribes one symbol and renders
 * LivePrice. Memoised, so a parent re-render does not touch it and a tick re-renders only it.
 */
export const PriceCell = memo(function PriceCell({
  symbol,
  exchange = 'NSE',
  format = 'inr',
  size = 'md',
  initial,
  className,
}: PriceCellProps) {
  const live = useQuote(symbol, exchange);
  if (!live && initial !== undefined) {
    return (
      <LivePrice
        value={initial}
        tick="flat"
        seq={0}
        format={format}
        size={size}
        className={className}
      />
    );
  }
  if (!live) {
    return (
      <Skeleton className={cn('inline-block w-20 align-middle', skeletonHeight[size], className)} />
    );
  }
  return (
    <LivePrice
      value={live.quote.ltp}
      tick={live.tick}
      seq={live.seq}
      format={format}
      size={size}
      className={className}
    />
  );
});

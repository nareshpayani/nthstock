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
  className?: string;
};

/**
 * The only component that reads live prices (ADR 0005): subscribes one symbol and renders
 * LivePrice. Memoised, so a parent re-render does not touch it and a tick re-renders only it.
 */
export const PriceCell = memo(function PriceCell({
  symbol,
  exchange = 'NSE',
  format = 'inr',
  size = 'md',
  className,
}: PriceCellProps) {
  const live = useQuote(symbol, exchange);
  if (!live) {
    return <Skeleton className={cn('inline-block h-4 w-20 align-middle', className)} />;
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

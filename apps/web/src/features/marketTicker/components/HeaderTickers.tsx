import { IndexTicker, Skeleton, cn } from '@nthstock/ui';
import { memo } from 'react';
import { useQuote } from '@/shared/hooks/useQuote';
import { headerIndices, type HeaderIndex } from '../model/headerIndices';
import { strings } from '../strings';

type LiveIndexTickerProps = HeaderIndex & { compact: boolean; stacked: boolean };

/** One live index. Memoised and subscribed on its own, so a tick re-renders only this ticker. */
const LiveIndexTicker = memo(function LiveIndexTicker({
  symbol,
  exchange,
  name,
  compact,
  stacked,
}: LiveIndexTickerProps) {
  const live = useQuote(symbol, exchange);
  if (!live) {
    return (
      <div
        className={cn(
          'flex whitespace-nowrap',
          stacked ? 'flex-col gap-0.5' : 'items-baseline gap-2',
        )}
        aria-busy="true"
      >
        <span className="text-label font-semibold text-ink-muted">{name}</span>
        <span className="sr-only">{strings.loading}</span>
        <Skeleton className={stacked ? 'h-3.5 w-24' : 'h-4 w-28 self-center'} />
      </div>
    );
  }
  const { ltp, change, changeBp } = live.quote;
  return (
    <IndexTicker
      name={name}
      level={ltp}
      change={change}
      changeBasisPoints={changeBp}
      compact={compact}
      stacked={stacked}
    />
  );
});

/** Nifty 50 and Sensex in the header, live from the quote store (T-092). */
export function HeaderTickers({
  className,
  compact = false,
  stacked = false,
}: {
  className?: string;
  compact?: boolean;
  /** Name above the figures, for the phone header (see `IndexTicker`). */
  stacked?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={strings.tickersLabel}
      className={cn('flex items-center', stacked ? 'gap-4' : 'gap-5', className)}
    >
      {headerIndices.map((index) => (
        <LiveIndexTicker key={index.symbol} {...index} compact={compact} stacked={stacked} />
      ))}
    </div>
  );
}

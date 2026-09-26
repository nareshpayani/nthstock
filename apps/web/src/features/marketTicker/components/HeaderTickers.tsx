import { IndexTicker, Skeleton, cn } from '@nthstock/ui';
import { memo } from 'react';
import { useQuote } from '@/shared/hooks/useQuote';
import { headerIndices, type HeaderIndex } from '../model/headerIndices';
import { strings } from '../strings';

type LiveIndexTickerProps = HeaderIndex & { compact: boolean };

/** One live index. Memoised and subscribed on its own, so a tick re-renders only this ticker. */
const LiveIndexTicker = memo(function LiveIndexTicker({
  symbol,
  exchange,
  name,
  compact,
}: LiveIndexTickerProps) {
  const live = useQuote(symbol, exchange);
  if (!live) {
    return (
      <div className="flex items-baseline gap-2 whitespace-nowrap" aria-busy="true">
        <span className="text-label font-semibold text-ink-muted">{name}</span>
        <span className="sr-only">{strings.loading}</span>
        <Skeleton className="h-4 w-28 self-center" />
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
    />
  );
});

/** Nifty 50 and Sensex in the header, live from the quote store (T-092). */
export function HeaderTickers({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={strings.tickersLabel}
      className={cn('flex items-center gap-5', className)}
    >
      {headerIndices.map((index) => (
        <LiveIndexTicker key={index.symbol} {...index} compact={compact} />
      ))}
    </div>
  );
}

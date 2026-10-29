import { IndexTicker, Skeleton, cn } from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { memo } from 'react';
import { useQuote } from '@/shared/hooks/useQuote';
import { useForcedState, useOffline } from '@/shared/lib/connectivity';
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
  // States (SPEC-CR-1 §7): an index that failed is hidden; the demo can force loading or error.
  const forced = useForcedState();
  if (forced === 'error') return null;
  if (!live || forced === 'loading') {
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
  // The ticker opens the index's chart page (NSTOCK-0437).
  return (
    <Link
      to="/stocks/$symbol"
      params={{ symbol }}
      search={{ exchange }}
      className="-mx-1 rounded-sm px-1 hover:bg-canvas focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
    >
      <IndexTicker
        name={name}
        level={ltp}
        change={change}
        changeBasisPoints={changeBp}
        compact={compact}
        stacked={stacked}
      />
    </Link>
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
  // Offline (SPEC-CR-1 §7): the last levels stay, dimmed and marked stale.
  const offline = useOffline();
  return (
    <div
      role="group"
      aria-label={strings.tickersLabel}
      data-stale={offline ? 'true' : undefined}
      className={cn(
        'flex items-center',
        stacked ? 'gap-4' : 'gap-5',
        offline && '[&>*:not([data-testid=tickers-stale])]:opacity-60',
        className,
      )}
    >
      {/* First, so a narrow strip that clips its end still says it. */}
      {offline ? (
        <span
          data-testid="tickers-stale"
          className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-label font-medium whitespace-nowrap text-ink-muted"
        >
          {strings.stale}
        </span>
      ) : null}
      {headerIndices.map((index) => (
        <LiveIndexTicker key={index.symbol} {...index} compact={compact} stacked={stacked} />
      ))}
    </div>
  );
}

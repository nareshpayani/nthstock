import { cn } from '@nthstock/ui';
import { systemClock, type Clock } from '@nthstock/utils';
import { useEffect, useState } from 'react';
import { marketStatusView, type MarketStatusView } from '../model/marketStatusText';
import { strings } from '../strings';

const toneClass: Record<MarketStatusView['tone'], { pill: string; dot: string }> = {
  open: { pill: 'bg-up-soft', dot: 'bg-up' },
  preOpen: { pill: 'bg-marigold-soft', dot: 'bg-marigold' },
  closed: { pill: 'bg-canvas', dot: 'bg-ink-muted' },
  holiday: { pill: 'bg-canvas', dot: 'bg-down' },
};

export type MarketStatusPillProps = {
  /** Injected for tests and demos; defaults to the system clock. */
  clock?: Clock;
  /** Hide the "opens …" detail (narrow headers). */
  compact?: boolean;
  className?: string;
};

/** NSE session state in IST, refreshed every 30 seconds. */
export function MarketStatusPill({
  clock = systemClock,
  compact = false,
  className,
}: MarketStatusPillProps) {
  // Re-render every 30 s so the status follows the clock; the view itself is derived on render.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const view = marketStatusView(clock);

  const tone = toneClass[view.tone];
  return (
    <p
      role="status"
      aria-label={`${strings.statusLabel}: ${view.label}, ${view.detail}`}
      className={cn(
        'inline-flex items-center gap-2 rounded-pill border border-line px-3 py-1 text-label whitespace-nowrap text-ink',
        tone.pill,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-2 rounded-pill', tone.dot)} />
      <span aria-hidden="true" className="font-semibold">
        {view.label}
      </span>
      {compact ? null : (
        <span aria-hidden="true" className="text-ink-muted">
          · {view.detail}
        </span>
      )}
    </p>
  );
}

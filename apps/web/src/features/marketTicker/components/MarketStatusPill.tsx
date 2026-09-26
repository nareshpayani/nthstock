import { cn } from '@nthstock/ui';
import { useContext } from 'react';
import { useMarketOpen } from '@/shared/hooks/useMarketOpen';
import { MarketSessionContext } from '@/shared/lib/marketSessionContext';
import { marketStatusView, type MarketStatusView } from '../model/marketStatusText';
import { strings } from '../strings';

const toneClass: Record<MarketStatusView['tone'], { pill: string; dot: string }> = {
  open: { pill: 'bg-up-soft', dot: 'bg-up' },
  preOpen: { pill: 'bg-marigold-soft', dot: 'bg-marigold' },
  closed: { pill: 'bg-canvas', dot: 'bg-ink-muted' },
  holiday: { pill: 'bg-canvas', dot: 'bg-down' },
};

export type MarketStatusPillProps = {
  /** Hide the "opens …" detail (narrow headers). */
  compact?: boolean;
  className?: string;
};

/**
 * NSE session state in IST. Reads the same market session as the LIVE badges (`useMarketOpen`):
 * the clock from MarketSessionContext, re-read every 30 seconds, and "open" whenever the mock
 * market is forced open.
 */
export function MarketStatusPill({ compact = false, className }: MarketStatusPillProps) {
  const { clock, alwaysOpen } = useContext(MarketSessionContext);
  // useMarketOpen re-renders the pill every 30 s (not at all when forced open), and the pill says
  // "Market open" exactly when the LIVE badges show. The rest of the view is derived on render.
  const open = useMarketOpen();
  const view = marketStatusView(clock, open && alwaysOpen);

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

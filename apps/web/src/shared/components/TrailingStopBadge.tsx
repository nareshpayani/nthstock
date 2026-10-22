import type { TrailingStop } from '@nthstock/contracts';
import { cn } from '@nthstock/ui';
import { TRAILING_STOP_NAME, trailingStopSummary } from '@/shared/lib/trailingStopView';

const TONE: Record<TrailingStop['status'], string> = {
  PENDING_ENTRY: 'bg-canvas text-ink-muted',
  ARMED: 'bg-brand-soft text-brand',
  TRAILING: 'bg-brand-soft text-brand',
  TRIGGERED: 'bg-marigold-soft text-ink',
  EXECUTED: 'bg-canvas text-ink-muted',
  CANCELLED: 'bg-canvas text-ink-muted',
  REJECTED: 'bg-down-soft text-down',
};

/**
 * A position's or order's trailing stop on a row (T11, SPEC-TFC-1 §6.2): "Trailing SL" and its
 * status in words, with the stop price while it trails. The words carry the meaning, not the tint.
 */
export function TrailingStopBadge({
  stop,
  className,
}: {
  stop: Pick<TrailingStop, 'status' | 'stopPrice' | 'statusReason'>;
  className?: string;
}) {
  return (
    <span
      data-testid="trailing-stop-badge"
      data-status={stop.status}
      className={cn(
        'inline-flex max-w-full rounded-sm px-1.5 py-0.5 text-label whitespace-nowrap',
        TONE[stop.status],
        className,
      )}
    >
      <span className="font-semibold">{TRAILING_STOP_NAME}</span>
      <span className="ml-1 truncate">{trailingStopSummary(stop)}</span>
    </span>
  );
}

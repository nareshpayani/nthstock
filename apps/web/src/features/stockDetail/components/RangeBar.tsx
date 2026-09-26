import type { Exchange } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import { memo } from 'react';
import { useQuote } from '@/shared/hooks/useQuote';
import { rangePercent } from '../model/statFormat';
import { strings } from '../strings';

export type RangeBarProps = {
  /** "Day range" or "52-week range". */
  name: string;
  symbol: string;
  exchange: Exchange;
  /** Range ends in paise, from InstrumentStats. */
  low: number;
  high: number;
  /** Last price from the stats snapshot, used until a live quote arrives. */
  fallback: number;
};

/**
 * Low–high bar with a marker at the last price (T-109). The ends come from InstrumentStats; the
 * marker follows the live quote (useQuote) and a live price outside the range stretches it, so
 * the day range stays true between stats refreshes. One text label carries the same facts for
 * screen readers.
 */
export const RangeBar = memo(function RangeBar({
  name,
  symbol,
  exchange,
  low,
  high,
  fallback,
}: RangeBarProps) {
  const ltp = useQuote(symbol, exchange)?.quote.ltp ?? fallback;
  const from = Math.min(low, ltp);
  const to = Math.max(high, ltp);
  const at = rangePercent(from, to, ltp);
  return (
    <div
      role="img"
      aria-label={strings.stats.rangeLabel(name, formatInr(from), formatInr(to), formatInr(ltp))}
      className="grid gap-1.5"
    >
      <p aria-hidden="true" className="text-label font-medium text-ink-muted">
        {name}
      </p>
      <div aria-hidden="true" className="relative h-1.5 rounded-full bg-line">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-brand/30"
          style={{ width: `${String(at)}%` }}
        />
        <div
          data-testid="range-marker"
          className="absolute -top-1 h-3.5 w-1 -translate-x-1/2 rounded-full bg-ink"
          style={{ left: `${String(at)}%` }}
        />
      </div>
      <div aria-hidden="true" className="flex justify-between gap-3 text-label">
        <span>
          <span className="text-ink-muted">{strings.stats.low} </span>
          <span className="font-mono text-ink tabular-nums">{formatInr(from)}</span>
        </span>
        <span className="text-right">
          <span className="text-ink-muted">{strings.stats.high} </span>
          <span className="font-mono text-ink tabular-nums">{formatInr(to)}</span>
        </span>
      </div>
    </div>
  );
});

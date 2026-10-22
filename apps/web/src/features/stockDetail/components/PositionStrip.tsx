import type { TradingState } from '@nthstock/apiClient';
import type { Instrument, Position } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import { useCallback } from 'react';
import { livePosition } from '@/features/positions';
import { PnlAmount } from '@/shared/components/PnlAmount';
import { usePositionTrailingStop } from '@/shared/hooks/useTrailingStops';
import { useQuote } from '@/shared/hooks/useQuote';
import { useTradingSelector } from '@/shared/hooks/useTradingSelector';
import { strings } from '../strings';

const samePositions = (a: readonly Position[], b: readonly Position[]) =>
  a.length === b.length &&
  a.every((position, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      position.product === other.product &&
      position.netQty === other.netQty &&
      position.avgBuyPrice === other.avgBuyPrice &&
      position.avgSellPrice === other.avgSellPrice &&
      position.realisedPnl === other.realisedPnl
    );
  });

function StripLine({ position }: { position: Position }) {
  const ltp = useQuote(position.symbol, position.exchange)?.quote.ltp;
  const live = livePosition(position, ltp);
  const stop = usePositionTrailingStop(position.token, position.product);
  const stopPrice =
    stop && (stop.status === 'TRAILING' || stop.status === 'TRIGGERED') ? stop.stopPrice : null;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-body">
      <span className="font-mono font-semibold tabular-nums">
        {strings.phone.strip.qty(position.netQty)}
      </span>
      {live.avgPrice === null ? null : (
        <span className="font-mono text-ink-muted tabular-nums">
          {strings.phone.strip.at(formatInr(live.avgPrice))}
        </span>
      )}
      <span aria-hidden="true">·</span>
      <PnlAmount value={live.pnl} size="sm" />
      {stopPrice === null ? null : (
        <>
          <span aria-hidden="true">·</span>
          <span className="text-label font-medium text-brand">
            {strings.phone.strip.trailing(formatInr(stopPrice))}
          </span>
        </>
      )}
    </p>
  );
}

/**
 * The phone position strip (T12, SPEC-TFC-1 §9.4): this instrument's open position, average, live
 * P&L and trailing stop, just above the bottom bar. Nothing while flat or while the trading store
 * is idle. Tapping it opens the trailing-stop sheet once that exists (T18).
 */
export function PositionStrip({ instrument }: { instrument: Instrument }) {
  const select = useCallback(
    (state: TradingState) =>
      state.positions.filter(
        (position) => position.token === instrument.token && position.netQty !== 0,
      ),
    [instrument.token],
  );
  const positions = useTradingSelector(select, samePositions);
  if (positions.length === 0) return null;
  return (
    <section
      aria-label={strings.phone.strip.label(instrument.symbol)}
      data-testid="position-strip"
      className="grid min-h-11 content-center gap-1 border-b border-line px-4 py-2"
    >
      {positions.map((position) => (
        <StripLine key={position.product} position={position} />
      ))}
    </section>
  );
}

import type { Position } from '@nthstock/contracts';
import { Button, TableCell, TableRow } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { memo } from 'react';
import { PriceCell } from '@/shared/components/PriceCell';
import { TrailingStopBadge } from '@/shared/components/TrailingStopBadge';
import { usePositionTrailingStop } from '@/shared/hooks/useTrailingStops';
import { usePositionEditorStore } from '@/shared/lib/positionEditorStore';
import { useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { exitIntent } from '../model/exitIntent';
import { livePosition } from '../model/livePnl';
import { strings } from '../strings';
import { PositionPnl, PositionPnlCell } from './PositionPnlCell';

/** Edit (NSTOCK-0395) and Exit (T-150) for a position with quantity open; null once it is flat. */
function usePositionActions(position: Position) {
  const openTicket = useTicketIntentStore((s) => s.openTicket);
  const openEditor = usePositionEditorStore((s) => s.openEditor);
  const exit = exitIntent(position);
  const product = strings.products[position.product].toLowerCase();
  return exit ? (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="secondary"
        aria-label={strings.editLabel(position.symbol, product)}
        onClick={() =>
          openEditor({
            symbol: position.symbol,
            exchange: position.exchange,
            token: position.token,
            product: position.product,
          })
        }
      >
        {strings.edit}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        aria-label={strings.exitLabel(position.symbol, product)}
        onClick={() => openTicket(exit)}
      >
        {strings.exit}
      </Button>
    </div>
  ) : null;
}

const averageOf = (position: Position) =>
  position.netQty === 0 ? null : livePosition(position, undefined).avgPrice;

/**
 * One position (T-149): product, stock, net quantity, average price, live LTP and live P&L, with
 * Edit (NSTOCK-0395) and Exit (T-150) while any quantity is open, and its trailing stop's status
 * and stop (T11). Memoised: only its LTP and P&L cells follow the ticks.
 */
export const PositionRow = memo(function PositionRow({ position }: { position: Position }) {
  const stop = usePositionTrailingStop(position.token, position.product);
  const actions = usePositionActions(position);
  const avg = averageOf(position);
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-label text-ink-muted">
        {strings.products[position.product]}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span className="font-semibold">{position.symbol}</span>
        <span className="ml-1 text-label text-ink-muted">{position.exchange}</span>
        {stop ? <TrailingStopBadge stop={stop} className="mt-1 flex w-fit" /> : null}
      </TableCell>
      <TableCell numeric>
        {position.netQty === 0 ? (
          <span className="font-sans text-label text-ink-muted">{strings.closed}</span>
        ) : (
          position.netQty
        )}
      </TableCell>
      <TableCell numeric className="whitespace-nowrap">
        {avg === null ? strings.noAverage : formatInr(avg)}
      </TableCell>
      <TableCell numeric>
        <PriceCell
          symbol={position.symbol}
          exchange={position.exchange}
          initial={position.ltp}
          size="sm"
        />
      </TableCell>
      <PositionPnlCell position={position} />
      <TableCell>{actions}</TableCell>
    </TableRow>
  );
});

/**
 * One position on a phone (NSTOCK-0447): the same facts as a row in three short lines, the stock
 * and its P&L, then product, quantity, average and LTP, then the stop and Edit and Exit, so
 * nothing is cut off at 320 px or scrolls sideways.
 */
export const PositionCard = memo(function PositionCard({ position }: { position: Position }) {
  const stop = usePositionTrailingStop(position.token, position.product);
  const actions = usePositionActions(position);
  const avg = averageOf(position);
  return (
    <li className="grid gap-1.5 px-4 py-3" data-symbol={position.symbol}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate">
          <span className="font-semibold">{position.symbol}</span>
          <span className="ml-1 text-label text-ink-muted">{position.exchange}</span>
        </span>
        <PositionPnl position={position} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink-muted">
        <span>{strings.products[position.product]}</span>
        <span data-column="qty" className="font-mono tabular-nums">
          {position.netQty === 0 ? strings.closed : strings.phone.qty(position.netQty)}
        </span>
        {avg === null ? null : (
          <span className="font-mono tabular-nums">{strings.phone.avg(formatInr(avg))}</span>
        )}
        <span className="ml-auto inline-flex items-baseline gap-1">
          {strings.columns.ltp}
          <PriceCell
            symbol={position.symbol}
            exchange={position.exchange}
            initial={position.ltp}
            size="sm"
          />
        </span>
      </div>
      {stop || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {stop ? <TrailingStopBadge stop={stop} className="flex w-fit" /> : <span />}
          {actions}
        </div>
      ) : null}
    </li>
  );
});

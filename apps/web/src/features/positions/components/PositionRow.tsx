import type { Position } from '@nthstock/contracts';
import { Button, TableCell, TableRow } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { memo } from 'react';
import { PriceCell } from '@/shared/components/PriceCell';
import { TrailingStopBadge } from '@/shared/components/TrailingStopBadge';
import { usePositionTrailingStop } from '@/shared/hooks/useTrailingStops';
import { useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { exitIntent } from '../model/exitIntent';
import { livePosition } from '../model/livePnl';
import { strings } from '../strings';
import { PositionPnlCell } from './PositionPnlCell';

/**
 * One position (T-149): product, stock, net quantity, average price, live LTP and live P&L, with
 * Exit (T-150) while any quantity is open, and its trailing stop's status and stop (T11). Memoised:
 * only its LTP and P&L cells follow the ticks.
 */
export const PositionRow = memo(function PositionRow({ position }: { position: Position }) {
  const openTicket = useTicketIntentStore((s) => s.openTicket);
  const stop = usePositionTrailingStop(position.token, position.product);
  const exit = exitIntent(position);
  const product = strings.products[position.product];
  const avg = position.netQty === 0 ? null : livePosition(position, undefined).avgPrice;
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-label text-ink-muted">{product}</TableCell>
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
      <TableCell>
        {exit ? (
          <Button
            size="sm"
            variant="secondary"
            aria-label={strings.exitLabel(position.symbol, product.toLowerCase())}
            onClick={() => openTicket(exit)}
          >
            {strings.exit}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
});

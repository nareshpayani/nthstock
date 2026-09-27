import type { Position } from '@nthstock/contracts';
import { TableCell } from '@nthstock/ui';
import { memo } from 'react';
import { PnlAmount } from '@/shared/components/PnlAmount';
import { useLivePosition } from '../hooks/useLivePositions';

/**
 * A position's live P&L (realised plus unrealised, T-149). The only part of a row that follows
 * the ticks: it subscribes its own symbol, so a tick re-renders this cell (and the LTP cell), not
 * the row.
 */
export const PositionPnlCell = memo(function PositionPnlCell({ position }: { position: Position }) {
  const live = useLivePosition(position);
  return (
    <TableCell numeric className="whitespace-nowrap">
      <PnlAmount value={live.pnl} size="sm" />
    </TableCell>
  );
});

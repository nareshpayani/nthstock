import type { Holding } from '@nthstock/contracts';
import { ChangeBadge, TableCell, TableRow } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { memo } from 'react';
import { PnlAmount } from '@/shared/components/PnlAmount';
import { PriceCell } from '@/shared/components/PriceCell';

/**
 * One holding at its live price (T-151): qty, average price, LTP, current value (qty × LTP in
 * paise), P&L and P&L %. Memoised on the live row object, which the live selector keeps while its
 * symbol does not tick, so a tick re-renders only that symbol's row.
 */
export const HoldingRow = memo(function HoldingRow({ holding }: { holding: Holding }) {
  return (
    <TableRow data-symbol={holding.symbol}>
      <TableCell className="whitespace-nowrap">
        <span className="font-semibold">{holding.symbol}</span>
        <span className="ml-1 text-label text-ink-muted">{holding.exchange}</span>
      </TableCell>
      <TableCell numeric>{holding.qty}</TableCell>
      <TableCell numeric className="whitespace-nowrap">
        {formatInr(holding.avgPrice)}
      </TableCell>
      <TableCell numeric>
        <PriceCell
          symbol={holding.symbol}
          exchange={holding.exchange}
          initial={holding.ltp}
          size="sm"
        />
      </TableCell>
      <TableCell numeric className="whitespace-nowrap" data-column="currentValue">
        {formatInr(holding.currentValue)}
      </TableCell>
      <TableCell numeric className="whitespace-nowrap" data-column="pnl">
        <PnlAmount value={holding.pnl} size="sm" />
      </TableCell>
      <TableCell numeric>
        <ChangeBadge basisPoints={holding.pnlBp} size="sm" />
      </TableCell>
    </TableRow>
  );
});

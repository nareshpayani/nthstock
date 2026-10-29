import type { Holding } from '@nthstock/contracts';
import { ChangeBadge, TableCell, TableRow } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { memo } from 'react';
import { PnlAmount } from '@/shared/components/PnlAmount';
import { PriceCell } from '@/shared/components/PriceCell';
import { strings } from '../strings';

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

/**
 * One holding on a phone (NSTOCK-0447): the stock and its P&L, then quantity, average and LTP,
 * then the current value, so nothing is cut off at 320 px or scrolls sideways.
 */
export const HoldingCard = memo(function HoldingCard({ holding }: { holding: Holding }) {
  return (
    <li className="grid gap-1.5 px-4 py-3" data-symbol={holding.symbol}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate">
          <span className="font-semibold">{holding.symbol}</span>
          <span className="ml-1 text-label text-ink-muted">{holding.exchange}</span>
        </span>
        <span className="inline-flex shrink-0 items-baseline gap-1.5">
          <PnlAmount value={holding.pnl} size="sm" />
          <ChangeBadge basisPoints={holding.pnlBp} size="sm" />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink-muted">
        <span className="font-mono tabular-nums">{strings.phone.qty(holding.qty)}</span>
        <span className="font-mono tabular-nums">
          {strings.phone.avg(formatInr(holding.avgPrice))}
        </span>
        <span className="ml-auto inline-flex items-baseline gap-1">
          {strings.columns.ltp}
          <PriceCell
            symbol={holding.symbol}
            exchange={holding.exchange}
            initial={holding.ltp}
            size="sm"
          />
        </span>
      </div>
      <div className="text-label text-ink-muted" data-column="currentValue">
        {strings.columns.currentValue}{' '}
        <span className="font-mono text-ink tabular-nums">{formatInr(holding.currentValue)}</span>
      </div>
    </li>
  );
});

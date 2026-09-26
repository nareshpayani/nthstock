import type { QuoteRow } from '@nthstock/contracts';
import { Link } from '@tanstack/react-router';
import { memo } from 'react';
import { LiveChange } from './LiveChange';
import { PriceCell } from './PriceCell';

/**
 * One stock in a list (curated lists, movers): name, symbol, live price and live day change, the
 * whole row a link to its detail page. Seeded with the REST row, then ticks from the quote store.
 */
export const StockRow = memo(function StockRow({ row }: { row: QuoteRow }) {
  const { symbol, exchange, name, ltp, change, changeBp } = row;
  return (
    <li>
      <Link
        to="/stocks/$symbol"
        params={{ symbol }}
        className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-canvas"
      >
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-pill bg-brand-soft text-label font-semibold text-brand"
        >
          {symbol.slice(0, 2)}
        </span>
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-body font-medium text-ink">{name}</span>
          <span className="text-label text-ink-muted">{`${symbol} · ${exchange}`}</span>
        </span>
        <span className="grid shrink-0 justify-items-end gap-0.5">
          <PriceCell symbol={symbol} exchange={exchange} initial={ltp} />
          <LiveChange symbol={symbol} exchange={exchange} initial={{ change, changeBp }} />
        </span>
      </Link>
    </li>
  );
});

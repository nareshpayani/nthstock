import type { IndexSummary } from '@nthstock/contracts';
import { Sparkline } from '@nthstock/ui';
import { formatChange } from '@nthstock/utils';
import { Link } from '@tanstack/react-router';
import { memo } from 'react';
import { LiveChange } from '@/shared/components/LiveChange';
import { PriceCell } from '@/shared/components/PriceCell';
import { strings } from '../strings';

/**
 * One index: name, live level, live ▲▼ change and the intraday sparkline. The whole card opens the
 * index's chart page (NSTOCK-0437).
 */
export const IndexCard = memo(function IndexCard({ summary }: { summary: IndexSummary }) {
  const { symbol, exchange, name, value, change, changeBp, sparkline } = summary;
  return (
    <li className="flex min-w-44 flex-1 snap-start">
      <Link
        to="/stocks/$symbol"
        params={{ symbol }}
        search={{ exchange }}
        className="grid flex-1 gap-2 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-brand hover:bg-canvas focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
      >
        <span className="text-label font-semibold text-ink-muted">{name}</span>
        <PriceCell symbol={symbol} exchange={exchange} format="index" initial={value} />
        <div className="flex items-end justify-between gap-2">
          <LiveChange
            symbol={symbol}
            exchange={exchange}
            format="index"
            initial={{ change, changeBp }}
            percentOnly
          />
          <Sparkline
            points={sparkline}
            label={strings.sparklineLabel(name)}
            width={88}
            height={28}
            direction={formatChange(changeBp).direction}
          />
        </div>
      </Link>
    </li>
  );
});

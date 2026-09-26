import type { IndexSummary } from '@nthstock/contracts';
import { Sparkline } from '@nthstock/ui';
import { formatChange } from '@nthstock/utils';
import { memo } from 'react';
import { LiveChange } from '@/shared/components/LiveChange';
import { PriceCell } from '@/shared/components/PriceCell';
import { strings } from '../strings';

/** One index: name, live level, live ▲▼ change and the intraday sparkline. */
export const IndexCard = memo(function IndexCard({ summary }: { summary: IndexSummary }) {
  const { symbol, exchange, name, value, change, changeBp, sparkline } = summary;
  return (
    <li className="grid min-w-44 flex-1 snap-start gap-2 rounded-lg border border-line bg-surface p-4">
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
    </li>
  );
});

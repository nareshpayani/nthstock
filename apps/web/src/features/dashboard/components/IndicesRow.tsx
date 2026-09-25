import { ChangeBadge, Sparkline, formatIndexLevel } from '@nthstock/ui';
import { formatChange } from '@nthstock/utils';
import { sampleIndices } from '@/features/marketTicker';
import { SampleBadge } from '@/shared/components/SampleBadge';
import { strings } from '../strings';

/** Horizontal index cards with sparklines. SAMPLE values until E4. */
export function IndicesRow() {
  return (
    <section aria-labelledby="indices-title" className="grid gap-3">
      <div className="flex items-center gap-3">
        <h2 id="indices-title" className="text-lg font-semibold text-ink">
          {strings.indicesTitle}
        </h2>
        <SampleBadge />
      </div>
      <ul className="relative flex snap-x gap-3 overflow-x-auto pb-1">
        {sampleIndices.map((index) => (
          <li
            key={index.symbol}
            className="grid min-w-48 flex-1 snap-start gap-2 rounded-lg border border-line bg-surface p-4"
          >
            <span className="text-label font-semibold text-ink-muted">{index.name}</span>
            <span className="font-mono text-lg font-medium text-ink tabular-nums">
              {formatIndexLevel(index.level)}
            </span>
            <div className="flex items-end justify-between gap-2">
              <ChangeBadge basisPoints={index.changeBasisPoints} size="sm" />
              <Sparkline
                points={index.series}
                label={`${index.name} today, ${formatChange(index.changeBasisPoints).srLabel}`}
                width={88}
                height={28}
                direction={formatChange(index.changeBasisPoints).direction}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

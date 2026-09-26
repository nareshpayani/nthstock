import { IndexTicker, cn } from '@nthstock/ui';
import { sampleIndices } from '../model/sampleIndices';
import { strings } from '../strings';

/** Nifty 50 and Sensex in the header. SAMPLE values, driven by props once E4 wires live data. */
export function HeaderTickers({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const shown = sampleIndices.filter(
    (index) => index.symbol === 'NIFTY 50' || index.symbol === 'SENSEX',
  );
  return (
    <div
      role="group"
      aria-label={strings.tickersLabel}
      title={strings.sampleNote}
      className={cn('flex items-center gap-5', className)}
    >
      {shown.map((index) => (
        <IndexTicker
          key={index.symbol}
          name={index.name}
          level={index.level}
          change={index.change}
          changeBasisPoints={index.changeBasisPoints}
          compact={compact}
        />
      ))}
    </div>
  );
}

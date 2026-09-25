import { ChangeBadge, SegmentedControl, Sparkline, formatIndexLevel } from '@nthstock/ui';
import { useState } from 'react';
import { sampleIndices, sampleNiftyYear } from '@/features/marketTicker';
import { Card } from '@/shared/components/Card';
import { SampleBadge } from '@/shared/components/SampleBadge';
import { strings } from '../strings';

const ranges = ['1D', '1W', '1M', '1Y', '5Y'] as const;
type Range = (typeof ranges)[number];

/**
 * NIFTY 50 chart card. SAMPLE: a static series drawn as an SVG line until TradingView Lightweight
 * Charts and live candles arrive (E4).
 */
export function IndexChartCard() {
  const [range, setRange] = useState<Range>('1Y');
  const nifty = sampleIndices[0];
  if (!nifty) return null;
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-3">
          {strings.chartTitle}
          <SampleBadge />
        </span>
      }
      aside={
        <SegmentedControl
          label={strings.rangeLabel}
          size="sm"
          value={range}
          onValueChange={setRange}
          options={ranges.map((value) => ({ value, label: value }))}
        />
      }
    >
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-display font-medium text-ink tabular-nums">
          {formatIndexLevel(nifty.level)}
        </span>
        <ChangeBadge
          basisPoints={nifty.changeBasisPoints}
          absolute={`${nifty.change >= 0 ? '+' : '-'}${formatIndexLevel(Math.abs(nifty.change))}`}
          soft
        />
      </div>
      <Sparkline
        points={sampleNiftyYear}
        label={strings.chartLabel(range)}
        width={800}
        height={220}
        fluid
        area
        className="h-40 w-full sm:h-56"
      />
    </Card>
  );
}

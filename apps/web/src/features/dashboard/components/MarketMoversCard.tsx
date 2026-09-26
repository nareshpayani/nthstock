import { SegmentedControl, Tabs, TabsContent, TabsList, TabsTrigger } from '@nthstock/ui';
import { useState } from 'react';
import { Card } from '@/shared/components/Card';
import { strings } from '../strings';
import { SkeletonRows } from './SkeletonRows';

const indexOptions = [
  { value: 'NIFTY 50', label: 'Nifty 50' },
  { value: 'NIFTY BANK', label: 'Bank' },
  { value: 'NIFTY IT', label: 'IT' },
] as const;
type MoversIndex = (typeof indexOptions)[number]['value'];

/** Gainers and losers by index. Skeleton rows until E4 (T-046). */
export function MarketMoversCard() {
  const [index, setIndex] = useState<MoversIndex>('NIFTY 50');
  return (
    <Card
      title={strings.moversTitle}
      aside={
        <SegmentedControl
          label={strings.moversIndex}
          size="sm"
          value={index}
          onValueChange={setIndex}
          options={indexOptions}
        />
      }
    >
      <Tabs defaultValue="gainers">
        <TabsList aria-label={strings.moversTitle}>
          <TabsTrigger value="gainers">{strings.gainers}</TabsTrigger>
          <TabsTrigger value="losers">{strings.losers}</TabsTrigger>
        </TabsList>
        <TabsContent value="gainers" className="pt-1">
          <SkeletonRows />
        </TabsContent>
        <TabsContent value="losers" className="pt-1">
          <SkeletonRows />
        </TabsContent>
      </Tabs>
      <p className="pt-2 text-label text-ink-muted">{strings.comingWithData}</p>
    </Card>
  );
}

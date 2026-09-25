import { Tabs, TabsContent, TabsList, TabsTrigger } from '@nthstock/ui';
import { Card } from '@/shared/components/Card';
import { strings } from '../strings';
import { SkeletonRows } from './SkeletonRows';

/** Curated lists (Market Giants, Best Returns, …). Skeleton rows until E4 (T-046). */
export function StocksListsCard() {
  return (
    <Card title={strings.listsTitle}>
      <Tabs defaultValue={strings.lists[0]}>
        <TabsList aria-label={strings.listsTitle}>
          {strings.lists.map((name) => (
            <TabsTrigger key={name} value={name}>
              {name}
            </TabsTrigger>
          ))}
        </TabsList>
        {strings.lists.map((name) => (
          <TabsContent key={name} value={name} className="pt-1">
            <SkeletonRows />
            <p className="pt-2 text-label text-ink-muted">{strings.comingWithData}</p>
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}

import { Skeleton } from '@nthstock/ui';
import { Card } from '@/shared/components/Card';
import { PageHeader } from '@/shared/components/PageHeader';
import { strings } from '../strings';

export function StockDetailPage({ symbol }: { symbol: string }) {
  return (
    <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6">
      <PageHeader title={symbol} description={strings.description} />
      <div role="status" aria-label={strings.loading} className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <div className="grid gap-3">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-56 w-full" />
          </div>
        </Card>
        <Card>
          <div className="grid gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </Card>
      </div>
    </div>
  );
}

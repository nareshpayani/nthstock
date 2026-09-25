import { Skeleton } from '@nthstock/ui';
import { strings } from '../strings';

/** Placeholder stock rows (name, price, change) while lists have no data yet. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div role="status" aria-label={strings.loadingRows} className="divide-y divide-line">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="size-8 rounded-pill" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
          <div className="grid justify-items-end gap-1.5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

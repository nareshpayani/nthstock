import { Skeleton } from '@nthstock/ui';

/** Placeholder stock rows (name, price, change) while a list loads; same height as StockRow. */
export function SkeletonRows({ count = 5, label }: { count?: number; label: string }) {
  return (
    <div role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5">
          <Skeleton className="size-8 rounded-pill" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="grid justify-items-end gap-1.5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

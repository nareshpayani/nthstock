import { Skeleton } from '@nthstock/ui';
import { strings } from '../strings';

/** Loading state with the form's rough shape, so the sheet does not jump when it arrives. */
export function TicketSkeleton() {
  return (
    <div role="status" aria-label={strings.loading} className="grid gap-4 p-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

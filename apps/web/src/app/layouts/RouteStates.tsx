import { ErrorState, Skeleton, buttonVariants } from '@nthstock/ui';
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { strings } from '../strings';

/** Error boundary UI for every route (router defaultErrorComponent): never a blank page. */
export function RouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="mx-auto w-full max-w-lg rounded-lg border border-line bg-surface">
      <ErrorState
        title={strings.errors.routeTitle}
        description={strings.errors.routeBody}
        retryLabel={strings.errors.retry}
        onRetry={() => {
          reset();
          void router.invalidate();
        }}
      />
    </div>
  );
}

/** Skeleton shown while a lazy route chunk or loader is pending. */
export function RoutePending() {
  return (
    <div
      role="status"
      aria-label={strings.loading}
      className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4"
    >
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function NotFound() {
  return (
    <div className="mx-auto grid w-full max-w-lg justify-items-center gap-3 rounded-lg border border-line bg-surface px-4 py-10 text-center">
      <p className="font-mono text-display text-brand">404</p>
      <h1 className="text-title text-ink">{strings.notFound.title}</h1>
      <p className="text-body text-ink-muted">{strings.notFound.body}</p>
      <Link to="/dashboard" className={buttonVariants({ variant: 'primary' })}>
        {strings.notFound.back}
      </Link>
    </div>
  );
}

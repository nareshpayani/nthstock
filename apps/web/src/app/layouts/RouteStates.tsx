import { ErrorState, Skeleton, buttonVariants } from '@nthstock/ui';
import { Link, useRouter, useRouterState, type ErrorComponentProps } from '@tanstack/react-router';
import { useContext, useEffect } from 'react';
import { useMarkFirstPaint } from '../firstPaint';
import { isChunkLoadError, reloadForNewBuild, reloadWhenOnline } from '../staleBuild';
import { strings } from '../strings';
import { InstrumentSkeleton, ShellSkeleton } from './PageSkeletons';
import { InShellContext } from './shellContext';

/** Centres a route-level state card in the content area, both ways, on every screen size. */
const CENTERED = 'grid min-h-[calc(100dvh-10rem)] w-full place-items-center';

/**
 * Error boundary UI for every route (router defaultErrorComponent): never a blank page. A route
 * whose code chunk could not load (a deploy replaced it, or the network dropped) reloads to the
 * current build at once, and its Try again reloads too, because a failed import never retries.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useMarkFirstPaint();
  const staleBuild = isChunkLoadError(error);
  useEffect(() => {
    if (staleBuild) reloadForNewBuild();
  }, [staleBuild]);
  return (
    <div className={CENTERED}>
      <div className="w-full max-w-lg rounded-lg border border-line bg-surface">
        <ErrorState
          title={strings.errors.routeTitle}
          description={strings.errors.routeBody}
          retryLabel={strings.errors.retry}
          onRetry={() => {
            if (staleBuild) {
              reloadWhenOnline();
              return;
            }
            reset();
            void router.invalidate();
          }}
        />
      </div>
    </div>
  );
}

/**
 * Skeleton shown while a lazy route chunk or loader is pending. The instrument page gets one in its
 * own shape (SPEC-CR-1 §5.6); other pages a generic one. Before the shell has rendered (a cold
 * load) the skeleton draws the shell too.
 */
export function RoutePending() {
  useMarkFirstPaint();
  const inShell = useContext(InShellContext);
  const instrument = useRouterState({
    select: (state) => state.location.pathname.startsWith('/stocks/'),
  });
  const page = instrument ? (
    <InstrumentSkeleton />
  ) : (
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
  return inShell || !instrument ? page : <ShellSkeleton>{page}</ShellSkeleton>;
}

export function NotFound() {
  useMarkFirstPaint();
  return (
    <div className={CENTERED}>
      <div className="grid w-full max-w-lg justify-items-center gap-3 rounded-lg border border-line bg-surface px-4 py-10 text-center">
        <p className="font-mono text-display text-brand">404</p>
        <h1 className="text-title text-ink">{strings.notFound.title}</h1>
        <p className="text-body text-ink-muted">{strings.notFound.body}</p>
        <Link to="/dashboard" className={buttonVariants({ variant: 'primary' })}>
          {strings.notFound.back}
        </Link>
      </div>
    </div>
  );
}

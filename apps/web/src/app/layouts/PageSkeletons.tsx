import { Skeleton, cn } from '@nthstock/ui';
import { useSyncExternalStore, type ReactNode } from 'react';
import { ChartSkeleton } from '@/shared/components/ChartSkeleton';
import { useLandscapePhone, usePhoneLayout } from '@/shared/hooks/usePhoneLayout';
import {
  DESKTOP_CHART_HEIGHT,
  landscapeChartHeight,
  phoneChartHeight,
} from '@/shared/lib/phoneChart';
import { strings } from '../strings';

/**
 * The app shell while it loads (SPEC-CR-1 §5.6): the header with the ticker row under 1360 px, and
 * the watchlist rail from 1024 px, at the shell's own sizes. Used on a cold load, before the shell
 * itself renders.
 */
export function ShellSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <div
        aria-hidden="true"
        data-testid="shell-skeleton"
        className="grid h-(--header-h) grid-rows-[56px_1fr] border-b border-line bg-surface min-[1360px]:grid-rows-[56px]"
      >
        <div className="flex items-center gap-3 px-4">
          <Skeleton className="size-6 lg:hidden" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="ml-auto h-8 w-16" />
          <Skeleton className="hidden h-8 w-8 sm:block" />
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 min-[1360px]:hidden">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <div className="flex">
        <div
          aria-hidden="true"
          className="hidden h-[calc(100dvh-var(--header-h))] w-80 shrink-0 gap-3 border-r border-line bg-surface p-4 lg:grid lg:content-start"
        >
          <Skeleton className="h-10 w-full rounded-md" />
          {Array.from({ length: 6 }, (_, row) => (
            <Skeleton key={row} className="h-11 w-full" />
          ))}
        </div>
        <div className="min-w-0 flex-1 p-4 lg:p-6">{children}</div>
      </div>
    </div>
  );
}

const subscribeResize = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};
const viewportHeight = () => window.innerHeight;

/**
 * The instrument page while its data loads, in the page's final shape (SPEC-CR-1 §5.6, §7): on a
 * phone the price block, the chart with its rail and range row, the tabs and the sticky Sell and
 * Buy bar; wider, the header card, the chart card and the side cards. The content then fades in
 * over it in 160 ms.
 */
export function InstrumentSkeleton() {
  const phone = usePhoneLayout();
  // Sized like the page it stands in for, so the chart does not jump when the page loads (CLS).
  const landscape = useLandscapePhone();
  const height = useSyncExternalStore(subscribeResize, viewportHeight, () => 800);
  return (
    <div role="status" aria-label={strings.loading} data-testid="instrument-skeleton">
      {phone ? (
        <PhoneInstrumentSkeleton
          chartHeight={landscape ? landscapeChartHeight(height) : phoneChartHeight(height)}
        />
      ) : (
        <DesktopInstrumentSkeleton />
      )}
    </div>
  );
}

function PhoneInstrumentSkeleton({ chartHeight }: { chartHeight: number }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <div className="grid min-w-0 flex-1 gap-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
          <Skeleton className="size-11 rounded-md" />
          <Skeleton className="size-11 rounded-md" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="grid justify-items-start gap-1">
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-6 w-28" />
          </div>
          <Skeleton className="h-11 w-28 rounded-md" />
        </div>
      </div>
      <div className="grid gap-2">
        <div className="flex justify-end gap-2">
          <Skeleton className="h-11 w-28 rounded-md" />
          <Skeleton className="h-11 w-16 rounded-md" />
        </div>
        <div className="-mx-4">
          <ChartSkeleton height={chartHeight} label={strings.loading} />
        </div>
        <Skeleton className="h-11 w-full rounded-md" />
      </div>
      <div className="flex h-11 items-center justify-around border-b border-line">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-14" />
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
      <div className="sticky bottom-0 -mx-4 -mb-4 grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-line bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Skeleton className="h-12 rounded-md" />
        <Skeleton className="h-12 rounded-md" />
        <Skeleton className="h-11 w-20 rounded-pill" />
      </div>
    </div>
  );
}

const card = 'rounded-lg border border-line bg-surface';

function DesktopInstrumentSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-4 lg:gap-6"
    >
      <div className={cn(card, 'grid gap-3 p-4 lg:p-5')}>
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-5 w-48" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-6 w-28" />
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] lg:items-start lg:gap-6">
        <div className={cn(card, 'grid gap-4 p-4')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-8 w-72 max-w-full rounded-md" />
          </div>
          <ChartSkeleton height={DESKTOP_CHART_HEIGHT} label={strings.loading} />
        </div>
        <div className={cn(card, 'grid gap-3 p-4 lg:row-span-3')}>
          <Skeleton className="h-6 w-32" />
          {Array.from({ length: 10 }, (_, row) => (
            <Skeleton key={row} className="h-5 w-full" />
          ))}
        </div>
        <div className={cn(card, 'grid gap-3 p-4')}>
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}

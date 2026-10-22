import { Sheet } from '@nthstock/ui';
import { Suspense, lazy } from 'react';
import { usePhoneLayout } from '@/shared/hooks/usePhoneLayout';
import { useSession } from '@/shared/hooks/useSession';
import { useTrailingSheetStore } from '@/shared/lib/trailingSheetStore';
import { strings } from '../strings';
import { TicketSkeleton } from './TicketSkeleton';

// Its own chunk, fetched on first open, like the order ticket (CLAUDE.md §3).
const TrailingStopSheet = lazy(() =>
  import('./TrailingStopSheet').then((module) => ({ default: module.TrailingStopSheet })),
);

/**
 * The trailing-stop sheet (T18, SPEC-TFC-1 §8.4), mounted once in the app shell and opened from
 * the chart's position chip. Rises from the bottom on a phone, within thumb reach, and slides in
 * from the right on a desktop, over a light overlay so the chart stays in view.
 */
export function TrailingStopSheetHost() {
  const target = useTrailingSheetStore((s) => s.target);
  const closeSheet = useTrailingSheetStore((s) => s.closeSheet);
  const { status } = useSession();
  const phone = usePhoneLayout();
  const open = target !== null && status === 'authenticated';
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
      title={target ? strings.sheet.title(target.symbol) : strings.sheet.titleFallback}
      description={strings.sheet.description}
      overlay="light"
      side={phone ? 'bottom' : 'right'}
      {...(phone ? {} : { className: 'w-[min(400px,calc(100vw-24px))]' })}
    >
      {open ? (
        <Suspense fallback={<TicketSkeleton />}>
          <TrailingStopSheet
            key={`${target.exchange}:${target.symbol}:${target.product ?? ''}`}
            target={target}
            onClose={closeSheet}
          />
        </Suspense>
      ) : null}
    </Sheet>
  );
}

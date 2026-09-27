import { Sheet } from '@nthstock/ui';
import { Suspense, lazy, useLayoutEffect, useRef } from 'react';
import { useSession } from '@/shared/hooks/useSession';
import { useTicketIntentStore } from '@/shared/lib/ticketIntentStore';
import { strings } from '../strings';
import { TicketSkeleton } from './TicketSkeleton';

// The ticket (form, React Hook Form, depth, review) is its own chunk, fetched on first open, so it
// adds nothing to the initial JS budget (CLAUDE.md §3).
const OrderTicket = lazy(() =>
  import('./OrderTicket').then((module) => ({ default: module.OrderTicket })),
);

/**
 * The order ticket slide-over (T-135), mounted once in the app shell. It opens from the ticket
 * intent (Buy/Sell on stock detail, watchlist rows and their B/S keys) once a session is held; a
 * signed-out Buy keeps the intent through /login, so the ticket opens on return. It slides in from
 * the right over a light overlay, so the chart and watchlist stay in view. Focus is trapped
 * inside, Esc closes it, and focus goes back to the control that opened it.
 */
export function OrderTicketHost() {
  const intent = useTicketIntentStore((s) => s.intent);
  const closeTicket = useTicketIntentStore((s) => s.closeTicket);
  const { status } = useSession();
  const open = intent !== null && status === 'authenticated';
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  // Remember what had focus before the sheet takes it (layout effects run before Radix's
  // focus effect), falling back to the main landmark after a login round trip.
  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      const active = document.activeElement;
      returnFocus.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : document.getElementById('main');
    }
    wasOpen.current = open;
  }, [open]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeTicket();
      }}
      title={intent ? strings.title(intent.symbol) : strings.titleFallback}
      description={strings.description}
      returnFocus={returnFocus}
      overlay="light"
      className="w-[min(440px,calc(100vw-24px))]"
    >
      {open ? (
        <Suspense fallback={<TicketSkeleton />}>
          <OrderTicket
            key={`${intent.exchange}:${intent.symbol}:${intent.side}`}
            intent={intent}
            onClose={closeTicket}
          />
        </Suspense>
      ) : null}
    </Sheet>
  );
}

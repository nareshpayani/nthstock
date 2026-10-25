import { Sheet } from '@nthstock/ui';
import { Suspense, lazy, useLayoutEffect, useRef } from 'react';
import { usePhoneLayout } from '@/shared/hooks/usePhoneLayout';
import { useSession } from '@/shared/hooks/useSession';
import { usePositionEditorStore } from '@/shared/lib/positionEditorStore';
import { strings } from '../strings';
import { TicketSkeleton } from './TicketSkeleton';

// Its own chunk, fetched on first open, like the order ticket (CLAUDE.md §3).
const PositionEditor = lazy(() =>
  import('./PositionEditor').then((module) => ({ default: module.PositionEditor })),
);

/**
 * The position editor (NSTOCK-0395), mounted once in the app shell and opened by Edit on a
 * Positions row or "Edit stop" on an order. Rises from the bottom on a phone and slides in from
 * the right on a desktop, like the order ticket; closing it returns focus to what opened it.
 */
export function PositionEditorHost() {
  const target = usePositionEditorStore((s) => s.target);
  const closeEditor = usePositionEditorStore((s) => s.closeEditor);
  const { status } = useSession();
  const phone = usePhoneLayout();
  const open = target !== null && status === 'authenticated';
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  // Layout effects run before Radix moves focus into the sheet (SPEC-TFC-1 §13).
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
        if (!next) closeEditor();
      }}
      title={
        target
          ? strings.editor.title(target.symbol, strings.products[target.product])
          : strings.editor.titleFallback
      }
      description={strings.editor.description}
      overlay="light"
      returnFocus={returnFocus}
      side={phone ? 'bottom' : 'right'}
      {...(phone ? {} : { className: 'w-[min(440px,calc(100vw-24px))]' })}
    >
      {open ? (
        <Suspense fallback={<TicketSkeleton />}>
          <PositionEditor
            key={`${target.exchange}:${target.symbol}:${target.product}:${target.tab ?? ''}`}
            target={target}
            onClose={closeEditor}
          />
        </Suspense>
      ) : null}
    </Sheet>
  );
}

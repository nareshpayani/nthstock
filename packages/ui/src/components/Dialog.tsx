import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode, RefObject } from 'react';
import { IconClose } from '../icons/icons.js';
import { cn } from '../lib/cn.js';

export type DialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog; focus returns to it on close. */
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Footer actions, e.g. Cancel and Confirm buttons. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Element to focus when opening (defaults to the first focusable element). */
  initialFocus?: RefObject<HTMLElement | null>;
};

function focusInitial(initialFocus: DialogProps['initialFocus']) {
  if (!initialFocus) return undefined;
  return (event: Event) => {
    if (!initialFocus.current) return;
    event.preventDefault();
    initialFocus.current.focus();
  };
}

const overlayClass =
  'fixed inset-0 z-(--nth-z-overlay) bg-ink/40 data-[state=open]:animate-overlay-in';

const closeButtonClass =
  'inline-flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-canvas hover:text-ink';

/**
 * Centred modal on Radix Dialog: focus is trapped inside, Esc and the close button dismiss it, and
 * focus returns to the trigger.
 */
export function Dialog({
  trigger,
  title,
  description,
  footer,
  children,
  className,
  initialFocus,
  ...root
}: DialogProps) {
  return (
    <DialogPrimitive.Root {...root}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={focusInitial(initialFocus)}
          className={cn(
            'fixed top-1/2 left-1/2 z-(--nth-z-overlay) grid max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg bg-surface p-6 shadow-overlay outline-none data-[state=open]:animate-pop-in',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <DialogPrimitive.Title className="text-title text-ink">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-body text-ink-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close className={closeButtonClass} aria-label="Close">
              <IconClose />
            </DialogPrimitive.Close>
          </div>
          {children}
          {footer ? <div className="flex justify-end gap-2">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export type SheetProps = DialogProps & {
  /** Which edge the panel slides from. Right for the order ticket, left for the nav drawer. */
  side?: 'right' | 'left';
};

/** Slide-over panel (order ticket, mobile drawer) with the same focus and Esc behaviour. */
export function Sheet({
  trigger,
  title,
  description,
  footer,
  children,
  className,
  side = 'right',
  initialFocus,
  ...root
}: SheetProps) {
  return (
    <DialogPrimitive.Root {...root}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={focusInitial(initialFocus)}
          className={cn(
            'fixed inset-y-0 z-(--nth-z-overlay) flex w-[min(420px,calc(100vw-48px))] flex-col bg-surface shadow-overlay outline-none',
            side === 'right'
              ? 'right-0 data-[state=open]:animate-sheet-in'
              : 'left-0 data-[state=open]:animate-drawer-in',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line p-4">
            <div className="grid gap-1">
              <DialogPrimitive.Title className="text-lg font-semibold text-ink">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-body text-ink-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close className={closeButtonClass} aria-label="Close">
              <IconClose />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? <div className="flex gap-2 border-t border-line p-4">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

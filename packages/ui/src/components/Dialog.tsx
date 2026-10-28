import { Dialog as DialogPrimitive } from 'radix-ui';
import { useCallback, useRef, type ReactNode, type RefObject } from 'react';
import { IconClose } from '../icons/icons.js';
import { cn } from '../lib/cn.js';
import { useKeyboardInset } from '../lib/keyboardInset.js';
import { useSheetDrag } from '../lib/sheetDrag.js';
import { TouchTargets } from '../lib/touchTargets.js';

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

/**
 * Esc pressed in a control whose own popup is open (an expanded combobox, e.g. stock search) closes
 * that popup first, not the whole dialog.
 */
function keepEscapeForOpenPopup(event: KeyboardEvent) {
  const target = event.target;
  if (target instanceof Element && target.getAttribute('aria-expanded') === 'true') {
    event.preventDefault();
  }
}

const overlayClass =
  'fixed inset-0 z-(--nth-z-overlay) bg-ink/40 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out';

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
          onEscapeKeyDown={keepEscapeForOpenPopup}
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
  /**
   * Which edge the panel slides from. Right for the order ticket on wide screens, left for the nav
   * drawer, bottom for phone sheets (SPEC-TFC-1 §9.4): full width, up to 90% of the screen height,
   * with the safe-area inset below its last action so it clears the iPhone home indicator.
   */
  side?: 'right' | 'left' | 'bottom';
  /**
   * Where focus goes on close when the sheet has no `trigger` (opened from a store, e.g. the order
   * ticket): usually the button that asked for it. Ignored when the element is gone.
   */
  returnFocus?: RefObject<HTMLElement | null>;
  /**
   * `dim` (default) shades the page behind; `light` barely tints it, so the page (chart, watchlist)
   * stays readable next to a slide-over such as the order ticket.
   */
  overlay?: 'dim' | 'light';
  /**
   * Docked beside the page instead of over it (tablets, SPEC-CR-1 §6.2): non-modal, no overlay,
   * below the app bar (`--nth-dock-top`) and `--nth-dock-w` wide. The page stays usable, so a tap
   * on the chart does not close it; Esc and Close still do. Its controls take the touch size.
   */
  docked?: boolean;
  /** Controls take their touch size in any form, e.g. a slide-over on a large tablet. */
  touchSize?: boolean;
};

function focusReturn(returnFocus: SheetProps['returnFocus']) {
  if (!returnFocus) return undefined;
  return (event: Event) => {
    const target = returnFocus.current;
    if (!target?.isConnected) return;
    event.preventDefault();
    target.focus();
  };
}

const SHEET_SIDE: Record<NonNullable<SheetProps['side']>, string> = {
  right: 'inset-y-0 right-0 w-[min(420px,calc(100vw-48px))] data-[state=open]:animate-sheet-in',
  left: 'inset-y-0 left-0 w-[min(420px,calc(100vw-48px))] data-[state=open]:animate-drawer-in',
  bottom:
    'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-[20px] pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-sheet-up data-[state=closed]:animate-sheet-down',
};

const DOCKED =
  'top-[var(--nth-dock-top,0px)] bottom-0 right-0 w-[var(--nth-dock-w,360px)] border-l border-line pb-[env(safe-area-inset-bottom)] shadow-none data-[state=open]:animate-sheet-in';

const keepOpen = (event: Event) => event.preventDefault();

/**
 * Slide-over panel (order ticket, mobile drawer) with the same focus and Esc behaviour. From the
 * bottom it is the phone form: every control in it is at least 44 × 44 px.
 */
export function Sheet({
  trigger,
  title,
  description,
  footer,
  children,
  className,
  side = 'right',
  initialFocus,
  returnFocus,
  overlay = 'dim',
  docked = false,
  touchSize = false,
  ...root
}: SheetProps) {
  // A bottom sheet is the phone form, so its controls take their touch size (SPEC-TFC-1 §9.4).
  const touch = side === 'bottom' && !docked;
  const keyboardInset = useKeyboardInset(touch);
  // Drag to dismiss (CR-T10) closes through the sheet's own Close, so focus return and
  // onOpenChange behave exactly as for a tap on it.
  const closeRef = useRef<HTMLButtonElement>(null);
  const { panelRef, grabProps } = useSheetDrag(touch, () => closeRef.current?.click());
  const contentRef = useCallback(
    (element: HTMLDivElement | null) => {
      keyboardInset(element);
      panelRef(element);
    },
    [keyboardInset, panelRef],
  );
  const grab = touch ? grabProps : {};
  return (
    <DialogPrimitive.Root modal={!docked} {...root}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        {docked ? null : (
          <DialogPrimitive.Overlay
            className={cn(overlayClass, overlay === 'light' && 'bg-ink/10')}
            data-overlay={overlay}
          />
        )}
        <DialogPrimitive.Content
          ref={contentRef}
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={focusInitial(initialFocus)}
          onCloseAutoFocus={focusReturn(returnFocus)}
          onEscapeKeyDown={keepEscapeForOpenPopup}
          {...(docked ? { onInteractOutside: keepOpen } : {})}
          data-side={side}
          data-docked={docked || undefined}
          className={cn(
            'fixed z-(--nth-z-overlay) flex flex-col bg-surface shadow-overlay outline-none',
            docked ? DOCKED : SHEET_SIDE[side],
            className,
          )}
        >
          {touch ? (
            // The grabber: a full-width strip, so the thumb finds it without aiming at the bar.
            <div
              aria-hidden="true"
              data-part="sheet-grabber"
              className="flex h-5 shrink-0 cursor-grab touch-none items-end justify-center"
              {...grab}
            >
              <span className="h-1 w-10 rounded-full bg-line" />
            </div>
          ) : null}
          <div
            className={cn(
              'flex items-start justify-between gap-4 border-b border-line p-4',
              touch && 'touch-none pt-2',
            )}
            {...grab}
          >
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
            <DialogPrimitive.Close
              ref={closeRef}
              className={cn(closeButtonClass, (touch || docked || touchSize) && 'size-11 shrink-0')}
              aria-label="Close"
            >
              <IconClose />
            </DialogPrimitive.Close>
          </div>
          <TouchTargets enabled={touch || docked || touchSize}>
            {/* A container: what is inside lays out by the panel's width, not the screen's. */}
            <div className="@container min-h-0 flex-1 overflow-y-auto">{children}</div>
            {footer ? <div className="flex gap-2 border-t border-line p-4">{footer}</div> : null}
          </TouchTargets>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

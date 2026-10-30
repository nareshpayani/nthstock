import { IconButton, IconClose } from '@nthstock/ui';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ChartValueFormat } from '../model/chartFormat';
import { keepsEscape } from '../model/drawings';
import { useDrawings } from '../model/drawingsStore';
import { strings } from '../strings';
import { ToolRail } from './ToolRail';

/** The height of the box the ref is on, kept in step with it (a rotated phone, a resize). */
function useBoxHeight<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const observer = new ResizeObserver((entries) => {
      setHeight(Math.floor(entries[0]?.contentRect.height ?? 0));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return [ref, height];
}

/**
 * Everything outside the keepers, taken as high up the tree as it goes: making these inert leaves
 * the keepers (the dialog, the toasts) usable while the rest of the page is not. Elements that are
 * inert already are left out, so closing does not wake them.
 */
function outside(keepers: readonly Element[], parent: Element): HTMLElement[] {
  return [...parent.children].flatMap((element) => {
    if (keepers.includes(element)) return [];
    if (keepers.some((keeper) => element.contains(keeper))) return outside(keepers, element);
    return element instanceof HTMLElement && !element.hasAttribute('inert') ? [element] : [];
  });
}

export type ChartWorkspaceProps = {
  /** "INFY" or "NIFTY 50": named in the dialog title. */
  name: string;
  /** The symbol whose drawings the rail edits. */
  symbol: string;
  /** Rupees or index points, for the drawings list. */
  format?: ChartValueFormat;
  /** Chart type, indicators and bar size, in the header row. */
  controls: ReactNode;
  /** The ranges, under the chart. */
  footer: ReactNode;
  onClose: () => void;
  /**
   * The button that opened it, for focus to go back to. Safari does not focus a tapped button, so
   * the focused element at open is not always it.
   */
  opener?: RefObject<HTMLElement | null>;
  /** The chart at the height left over. */
  children: (height: number) => ReactNode;
};

/**
 * The full-screen chart (NSTOCK-0461): the whole window for the plot, the tool rail down its left
 * side, the controls along the top and the ranges along the bottom. A modal dialog over the page,
 * so it works the same on a phone (landscape too) and on a desktop. The page behind (all but the toasts) is inert while
 * it is open; Escape or Close leave it, and focus goes back to the button that opened it. It sits
 * on the overlay layer, so its menus (popover), toasts and an order ticket opened from it show above.
 */
export function ChartWorkspace({
  name,
  symbol,
  format = 'inr',
  controls,
  footer,
  onClose,
  opener: openerRef,
  children,
}: ChartWorkspaceProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The plot takes whatever the header and the ranges leave, measured, so nothing is pushed off.
  const [bodyRef, height] = useBoxHeight<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const opener = openerRef?.current ?? focused;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Modal: the page behind can't be tabbed to, clicked or read while the chart is full screen.
    const keepers = [dialogRef.current, ...document.querySelectorAll('[data-nth-toasts]')].filter(
      (element): element is Element => element !== null,
    );
    const behind = outside(keepers, document.body);
    for (const element of behind) element.setAttribute('inert', '');
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || keepsEscape(event.target)) return;
      event.preventDefault();
      // Escape first drops a tool that is waiting for taps; the next one closes.
      const { tool, setTool } = useDrawings.getState();
      if (tool === null) onCloseRef.current();
      else setTool(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // The opener is read when the dialog opens; a later change of button is not followed.
      for (const element of behind) element.removeAttribute('inert');
      document.body.style.overflow = overflow;
      useDrawings.getState().setTool(null);
      opener?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, []);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={strings.fullscreen.title(name)}
      data-testid="chart-workspace"
      className="fixed inset-0 z-(--nth-z-overlay) flex flex-col gap-2 bg-surface px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {/* Name and Close on one row, the controls on the next where a phone is narrow. */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">{name}</h2>
        <IconButton
          ref={closeRef}
          label={strings.fullscreen.close}
          icon={<IconClose />}
          onClick={onClose}
          className="order-2 sm:order-3"
        />
        <div className="order-3 flex w-full items-center gap-2 overflow-x-auto sm:order-2 sm:w-auto">
          {controls}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-1">
        <ToolRail symbol={symbol} touch height={height} format={format} className="shrink-0" />
        <div ref={bodyRef} className="relative min-h-0 min-w-0 flex-1">
          {height > 0 ? children(height) : null}
        </div>
      </div>
      <div>{footer}</div>
    </div>,
    document.body,
  );
}

/** Two arrows out to the corners. */
export function ExpandGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3h5v5M17 3l-6 6M8 17H3v-5M3 17l6-6" />
    </svg>
  );
}

/** A pencil, for the phone's Draw button. */
export function DrawGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 16 1-4L13.5 3.5l3 3L8 15l-4 1ZM11.5 5.5l3 3" />
    </svg>
  );
}

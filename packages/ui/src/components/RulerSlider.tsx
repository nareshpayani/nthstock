import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '../lib/cn.js';

export type RulerSliderProps = {
  /** Integer value in `step` units' base (shares, or paise). */
  value: number;
  onChange: (value: number) => void;
  /** One tick: 1 share, or the tick size in paise. */
  step: number;
  min?: number;
  max?: number;
  /** A labelled major tick every this many steps. */
  majorEvery?: number;
  /** Distance between ticks, px. */
  tickPx?: number;
  /** A major tick's label, e.g. "₹1,480". */
  formatMajor: (value: number) => string;
  /** The value in words for screen readers, e.g. "₹1,482.35". */
  valueText: (value: number) => string;
  /** Accessible name, e.g. "Adjust price". */
  label: string;
  /** Called once per tick crossed while dragging, for a selection haptic. */
  onTick?: () => void;
  /** A short caption pinned to the ruler's left edge, e.g. "QTY". Decorative; `label` names it. */
  badge?: string;
  disabled?: boolean;
  className?: string;
};

/** Ticks drawn each side of the needle; more than a 440 px sheet shows at 8 px. */
const SIDE_TICKS = 32;

/**
 * nthstock's ruler (A8): the chart's price rail, as a control. Slide the scale under the fixed
 * needle to set a price or a quantity one tick at a time, with a selection haptic per tick, beside
 * the number input. It owns its gesture (`touch-action: none`), so the sheet and page hold still.
 * A slider for assistive tech: arrows move a tick, Page Up/Down ten.
 */
export function RulerSlider({
  value,
  onChange,
  step,
  min = step,
  max = Number.MAX_SAFE_INTEGER,
  majorEvery = 10,
  tickPx = 8,
  formatMajor,
  valueText,
  label,
  onTick,
  badge,
  disabled = false,
  className,
}: RulerSliderProps) {
  const drag = useRef<{ pointerId: number; x: number; from: number } | null>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const snapped = clamp(Math.round(value / step) * step);

  const set = (next: number) => {
    const clamped = clamp(next);
    if (clamped === snapped) return;
    onChange(clamped);
    onTick?.();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || drag.current) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, from: snapped };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    // Dragging the scale left brings higher values under the needle.
    const ticks = Math.round((active.x - event.clientX) / tickPx);
    set(active.from + ticks * step);
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const by: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageUp: majorEvery,
      PageDown: -majorEvery,
    };
    if (disabled) return;
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      set(event.key === 'Home' ? min : max);
      return;
    }
    const steps = by[event.key];
    if (steps === undefined) return;
    event.preventDefault();
    set(snapped + steps * step);
  };

  const ticks = [];
  for (let k = -SIDE_TICKS; k <= SIDE_TICKS; k += 1) {
    const at = snapped + k * step;
    if (at < min || at > max) continue;
    const major = Math.round(at / step) % majorEvery === 0;
    ticks.push(
      <span
        key={at}
        aria-hidden="true"
        className="absolute bottom-0 flex -translate-x-1/2 flex-col items-center"
        style={{ left: `calc(50% + ${k * tickPx}px)` }}
      >
        {major ? (
          <span className="mb-0.5 font-mono text-[10px] leading-none text-ink-muted tabular-nums">
            {formatMajor(at)}
          </span>
        ) : null}
        <span className={cn('w-px bg-ink-muted/60', major ? 'h-3 bg-ink-muted' : 'h-1.5')} />
      </span>,
    );
  }

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max === Number.MAX_SAFE_INTEGER ? undefined : max}
      aria-valuenow={snapped}
      aria-valuetext={valueText(snapped)}
      aria-disabled={disabled || undefined}
      data-testid="ruler-slider"
      className={cn(
        'relative h-9 touch-none overflow-hidden rounded-md border border-line bg-canvas select-none',
        'cursor-ew-resize focus-visible:outline-3 focus-visible:outline-brand',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      {ticks}
      {/* The needle: the value sits under it, like a line's tab on the price rail. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-pill bg-brand"
      />
      {/* Edges fade, so the scale reads as passing under the needle. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,var(--nth-color-canvas),transparent_22%,transparent_78%,var(--nth-color-canvas))]"
      />
      {badge ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 left-1.5 text-[10px] font-semibold tracking-wide text-ink-muted uppercase"
        >
          {badge}
        </span>
      ) : null}
    </div>
  );
}

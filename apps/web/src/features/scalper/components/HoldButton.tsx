import { cn } from '@nthstock/ui';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** How long Reverse must be held (SPEC-TFC-1 §11.3, TFC-09). */
export const HOLD_MS = 400;

const RING_RADIUS = 9;
const RING = 2 * Math.PI * RING_RADIUS;
const HOLD_KEYS = new Set(['Enter', ' ']);

export type HoldButtonProps = {
  /** False while disarmed or flat: the button shows why and holding does nothing. */
  ready: boolean;
  onHold: () => void;
  describedBy: string;
  testId: string;
  className?: string;
  children: ReactNode;
};

/**
 * A button that acts only after it is held for `HOLD_MS` (T22), with a progress ring that fills
 * while it is held. A finger or mouse holds it down; keyboard users hold Enter or Space. Letting
 * go, sliding off, a cancelled touch or losing focus before the ring is full sends nothing, and a
 * plain click never acts.
 */
export function HoldButton({
  ready,
  onHold,
  describedBy,
  testId,
  className,
  children,
}: HoldButtonProps) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onHold);
  useEffect(() => {
    latest.current = onHold;
  }, [onHold]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const start = () => {
    if (!ready || timer.current !== null) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      latest.current();
    }, HOLD_MS);
  };
  const stop = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!HOLD_KEYS.has(event.key)) return;
    // No click on release, and a held key's repeats do not restart the hold.
    event.preventDefault();
    if (!event.repeat) start();
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (HOLD_KEYS.has(event.key)) stop();
  };

  return (
    <button
      type="button"
      aria-disabled={!ready}
      aria-describedby={describedBy}
      data-testid={testId}
      data-holding={holding}
      onPointerDown={(event) => {
        if (event.button === 0) start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={stop}
      onContextMenu={(event) => event.preventDefault()}
      className={cn('relative touch-manipulation select-none', className)}
    >
      {children}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={cn('absolute top-1.5 right-1.5 size-5 -rotate-90', !ready && 'hidden')}
      >
        <circle
          cx="12"
          cy="12"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2.5"
          className="stroke-line"
        />
        <circle
          cx="12"
          cy="12"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={RING}
          data-testid={`${testId}-ring`}
          className="stroke-current"
          style={{
            strokeDashoffset: holding ? 0 : RING,
            transition: holding ? `stroke-dashoffset ${String(HOLD_MS)}ms linear` : 'none',
          }}
        />
      </svg>
    </button>
  );
}

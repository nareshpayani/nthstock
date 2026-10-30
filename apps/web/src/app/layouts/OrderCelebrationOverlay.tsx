import { LOGO_MARK } from '@nthstock/ui';
import { useEffect, useRef, useState } from 'react';
import {
  subscribeOrderCelebrations,
  type OrderCelebration,
} from '@/shared/motion/orderCelebration';
import { prefersReducedMotion } from '@/shared/motion/useReducedMotion';
import { strings } from '../strings';

/** How long the moment stays on screen, in ms. Short enough not to hold up the next trade. */
export const CELEBRATION_MS = 1400;
/** With reduced motion, a fade of this length, in ms. */
export const REDUCED_MS = 700;
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** The rising line's length in its own units, so it can be drawn in with a dash offset. */
const RISE_LENGTH = 40;

/**
 * The order-placed micro-interaction: the nth app tile springs in, a ring ripples out, the
 * logo's rising line draws itself and a small tick lands on the tile, then it all lifts away.
 * It never takes a tap (the sheet behind is closing anyway). With reduced motion it is a short
 * fade of the finished mark.
 */
export function OrderCelebrationOverlay() {
  const [current, setCurrent] = useState<OrderCelebration | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeOrderCelebrations(setCurrent), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!current || !root) return;
    const reduced = prefersReducedMotion();
    const part = (name: string) =>
      root.querySelector<HTMLElement | SVGElement>(`[data-part="${name}"]`);
    const play = (
      element: Element | null,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ): Animation | undefined =>
      typeof element?.animate === 'function'
        ? element.animate(frames, { fill: 'both', ...options })
        : undefined;
    const animations = reduced
      ? [
          play(
            root,
            [
              { opacity: 0 },
              { opacity: 1, offset: 0.2 },
              { opacity: 1, offset: 0.75 },
              { opacity: 0 },
            ],
            { duration: REDUCED_MS },
          ),
        ]
      : [
          play(
            root,
            [
              { opacity: 0 },
              { opacity: 1, offset: 0.12 },
              { opacity: 1, transform: 'translateY(0)', offset: 0.78 },
              { opacity: 0, transform: 'translateY(-16px)' },
            ],
            { duration: CELEBRATION_MS, easing: 'ease-in-out' },
          ),
          play(
            part('tile'),
            [
              { transform: 'scale(0.4) rotate(-8deg)' },
              { transform: 'scale(1.12) rotate(2deg)', offset: 0.55 },
              { transform: 'scale(1) rotate(0deg)' },
            ],
            { duration: 420, easing: EASE_OUT },
          ),
          play(
            part('ring'),
            [
              { transform: 'scale(0.8)', opacity: 0.55 },
              { transform: 'scale(2.1)', opacity: 0 },
            ],
            { duration: 700, delay: 120, easing: 'ease-out' },
          ),
          play(
            part('rise'),
            [{ strokeDashoffset: String(RISE_LENGTH) }, { strokeDashoffset: '0' }],
            { duration: 360, delay: 220, easing: EASE_OUT },
          ),
          play(
            part('tick'),
            [
              { transform: 'scale(0)', opacity: 0 },
              { transform: 'scale(1.25)', opacity: 1, offset: 0.6 },
              { transform: 'scale(1)', opacity: 1 },
            ],
            { duration: 300, delay: 380, easing: EASE_OUT },
          ),
          play(
            part('label'),
            [
              { transform: 'translateY(6px)', opacity: 0 },
              { transform: 'translateY(0)', opacity: 1 },
            ],
            { duration: 260, delay: 260, easing: EASE_OUT },
          ),
        ];
    const timer = setTimeout(
      () => setCurrent((shown) => (shown?.id === current.id ? null : shown)),
      reduced ? REDUCED_MS : CELEBRATION_MS,
    );
    return () => {
      clearTimeout(timer);
      for (const animation of animations) animation?.cancel();
    };
  }, [current]);

  if (!current) return null;
  return (
    <div
      ref={rootRef}
      key={current.id}
      aria-hidden="true"
      data-testid="order-celebration"
      data-kind={current.kind}
      className="pointer-events-none fixed inset-0 z-(--nth-z-toast) grid place-items-center"
    >
      <div className="grid justify-items-center gap-3 rounded-[28px] bg-surface/90 px-8 pt-7 pb-5 shadow-overlay backdrop-blur-sm">
        <div className="relative size-24">
          <span
            data-part="ring"
            className="absolute inset-0 rounded-[26px] border-4 border-brand"
          />
          <svg
            data-part="tile"
            viewBox="0 0 120 120"
            className="relative size-24 drop-shadow-md"
            focusable="false"
          >
            <rect width="120" height="120" rx="27" className="fill-brand" />
            <g
              transform="translate(19.74 38.22) scale(.66)"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={LOGO_MARK.n} strokeWidth={LOGO_MARK.stroke} className="stroke-surface" />
              <path d={LOGO_MARK.th} strokeWidth={LOGO_MARK.stroke} className="stroke-brand-soft" />
              <path
                data-part="rise"
                d={LOGO_MARK.rise}
                strokeWidth={LOGO_MARK.riseStroke}
                pathLength={RISE_LENGTH}
                strokeDasharray={RISE_LENGTH}
                className="stroke-marigold"
              />
            </g>
          </svg>
          <span
            data-part="tick"
            className="absolute -right-2 -bottom-2 grid size-9 place-items-center rounded-full border-4 border-surface bg-ink text-surface"
          >
            <svg viewBox="0 0 24 24" className="size-4" focusable="false">
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
        <p data-part="label" className="text-body font-semibold text-ink">
          {current.kind === 'filled' ? strings.celebration.filled : strings.celebration.placed}
        </p>
      </div>
    </div>
  );
}

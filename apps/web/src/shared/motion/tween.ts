/**
 * A timed glide for moves the user did not make (SPEC-CR-1 §5.3): the trailing stop's ratchet
 * glides 240 ms and its trace fades. Decelerating, like the tokens' `easing`. Drags and sheets use
 * the spring instead; this is for moves with a known length.
 */
export const RATCHET_GLIDE_MS = 240;
/** How long the trace left at a ratchet's old price takes to fade. */
export const RATCHET_TRACE_MS = 700;

/** Ease-out cubic: fast start, gentle stop. `t` runs 0 to 1. */
export const easeOut = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export type TweenOptions = {
  /** Jump straight to the target (reduced motion). */
  instant?: boolean;
  /** Called once the tween reaches the target; not called when it is stopped early. */
  onDone?: () => void;
};

/**
 * Animates from `from` to `to` over `durationMs`, calling `onFrame` with each value on animation
 * frames. Returns a function that stops it where it is.
 */
export function animateTween(
  from: number,
  to: number,
  durationMs: number,
  onFrame: (value: number) => void,
  { instant = false, onDone }: TweenOptions = {},
): () => void {
  if (instant || from === to || durationMs <= 0) {
    onFrame(to);
    onDone?.();
    return () => undefined;
  }
  let start: number | undefined;
  let frame = 0;
  const tick = (now: number) => {
    start ??= now;
    const t = (now - start) / durationMs;
    if (t >= 1) {
      onFrame(to);
      onDone?.();
      return;
    }
    onFrame(from + (to - from) * easeOut(t));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

import { spring as SPRING } from '@nthstock/tokens';

/**
 * The one spring for drags and sheets (SPEC-CR-1 §4.1): critically damped, so it settles on its
 * target without overshooting. Pure maths here; `animateSpring` drives it on animation frames.
 */
export type SpringState = { value: number; velocity: number };

/** Below these the spring counts as settled and snaps to the target. */
const REST_DISTANCE = 0.01;
const REST_VELOCITY = 0.01;
/** Natural frequency, rad/s. The tokens' damping is 2·√(stiffness·mass): critical. */
const OMEGA = Math.sqrt(SPRING.stiffness / SPRING.mass);

/**
 * The state `dtSeconds` later, from the exact solution of the critically damped spring,
 * x(t) = target + (a + b·t)·e^(−ωt) with a = x₀ − target and b = v₀ + ω·a. Exact for any step, so
 * a 30 fps device or a dropped frame can't make it overshoot (a numeric step could).
 */
export function stepSpring(state: SpringState, target: number, dtSeconds: number): SpringState {
  const t = Math.max(0, dtSeconds);
  const a = state.value - target;
  const b = state.velocity + OMEGA * a;
  const decay = Math.exp(-OMEGA * t);
  const value = target + (a + b * t) * decay;
  const velocity = (b - OMEGA * (a + b * t)) * decay;
  if (Math.abs(value - target) < REST_DISTANCE && Math.abs(velocity) < REST_VELOCITY) {
    return { value: target, velocity: 0 };
  }
  return { value, velocity };
}

export function isAtRest(state: SpringState, target: number): boolean {
  return state.value === target && state.velocity === 0;
}

export type SpringOptions = {
  /** Starting velocity in units per second, e.g. a flick's speed. */
  velocity?: number;
  /** Jump straight to the target (reduced motion). */
  instant?: boolean;
  /** Called once the spring rests on the target; not called when it is stopped early. */
  onDone?: () => void;
};

/**
 * Animates from `from` to `to`, calling `onFrame` with each value on animation frames (write a
 * transform there, never React state). Returns a function that stops it where it is.
 */
export function animateSpring(
  from: number,
  to: number,
  onFrame: (value: number) => void,
  { velocity = 0, instant = false, onDone }: SpringOptions = {},
): () => void {
  if (instant || from === to) {
    onFrame(to);
    onDone?.();
    return () => undefined;
  }
  let state: SpringState = { value: from, velocity };
  let last: number | undefined;
  let frame = 0;
  const tick = (now: number) => {
    const dt = last === undefined ? 1 / 60 : (now - last) / 1000;
    last = now;
    state = stepSpring(state, to, dt);
    onFrame(state.value);
    if (isAtRest(state, to)) {
      onDone?.();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

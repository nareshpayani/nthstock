import { spring as SPRING } from '@nthstock/tokens';

/**
 * The one spring for drags and sheets (SPEC-CR-1 §4.1): critically damped, so it settles on its
 * target without overshooting. Pure maths here; `animateSpring` drives it on animation frames.
 */
export type SpringState = { value: number; velocity: number };

/** Below these the spring counts as settled and snaps to the target. */
const REST_DISTANCE = 0.01;
const REST_VELOCITY = 0.01;
/** Longest step integrated at once, so a dropped frame cannot make the spring explode. */
const MAX_STEP_S = 1 / 30;

/** One step of `dtSeconds` towards `target` (semi-implicit Euler, in sub-steps of at most 1/30 s). */
export function stepSpring(state: SpringState, target: number, dtSeconds: number): SpringState {
  let { value, velocity } = state;
  let remaining = Math.max(0, dtSeconds);
  while (remaining > 0) {
    const dt = Math.min(remaining, MAX_STEP_S);
    const force = -SPRING.stiffness * (value - target) - SPRING.damping * velocity;
    velocity += (force / SPRING.mass) * dt;
    value += velocity * dt;
    remaining -= dt;
  }
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

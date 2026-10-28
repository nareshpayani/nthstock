import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animateSpring, stepSpring, type SpringState } from './spring';

function settle(from: number, to: number, velocity = 0, dt = 1 / 60) {
  let state: SpringState = { value: from, velocity };
  const values: number[] = [];
  for (let frame = 0; frame < 2 / dt; frame += 1) {
    state = stepSpring(state, to, dt);
    values.push(state.value);
  }
  return { state, values };
}

describe('stepSpring', () => {
  it('settles on the target within two seconds and rests there', () => {
    const { state } = settle(0, 100);
    expect(state).toEqual({ value: 100, velocity: 0 });
  });

  it('never overshoots the target from rest (critically damped)', () => {
    const { values } = settle(0, 100);
    expect(Math.max(...values)).toBeLessThanOrEqual(100);
    const down = settle(100, 0).values;
    expect(Math.min(...down)).toBeGreaterThanOrEqual(0);
  });

  it('never overshoots at 30 fps or 120 fps either (exact solution, not a numeric step)', () => {
    for (const dt of [1 / 30, 1 / 120]) {
      const { values, state } = settle(0, 100, 0, dt);
      expect(Math.max(...values)).toBeLessThanOrEqual(100);
      expect(state.value).toBe(100);
    }
  });

  it('carries a flick: velocity towards the target arrives sooner', () => {
    const still = stepSpring({ value: 0, velocity: 0 }, 100, 0.05).value;
    const flicked = stepSpring({ value: 0, velocity: 2_000 }, 100, 0.05).value;
    expect(flicked).toBeGreaterThan(still);
  });

  it('treats a negative step as no time', () => {
    expect(stepSpring({ value: 10, velocity: 0 }, 100, -1)).toEqual({ value: 10, velocity: 0 });
  });

  it('survives a long dropped frame without blowing up', () => {
    const state = stepSpring({ value: 0, velocity: 0 }, 50, 2);
    expect(state.value).toBeCloseTo(50, 0);
  });
});

describe('stepSpring at coarse frame rates', () => {
  it.each([1 / 30, 1 / 20, 1 / 10])('never crosses the target at dt = %f', (dt) => {
    let state: SpringState = { value: 0, velocity: 0 };
    for (let frame = 0; frame < 200; frame += 1) {
      state = stepSpring(state, 100, dt);
      expect(state.value).toBeLessThanOrEqual(100);
    }
    expect(state.value).toBe(100);
  });
});

describe('animateSpring', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('jumps straight to the target when instant (reduced motion)', () => {
    const frames: number[] = [];
    const done = vi.fn();
    animateSpring(0, 40, (value) => frames.push(value), { instant: true, onDone: done });
    expect(frames).toEqual([40]);
    expect(done).toHaveBeenCalledOnce();
  });

  it('runs on animation frames until it rests, then calls onDone', () => {
    const frames: number[] = [];
    const done = vi.fn();
    animateSpring(0, 40, (value) => frames.push(value), { onDone: done });
    vi.advanceTimersByTime(2_000);
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.at(-1)).toBe(40);
    expect(done).toHaveBeenCalledOnce();
  });

  it('stops where it is when cancelled', () => {
    const frames: number[] = [];
    const stop = animateSpring(0, 40, (value) => frames.push(value));
    vi.advanceTimersByTime(50);
    stop();
    const count = frames.length;
    vi.advanceTimersByTime(1_000);
    expect(frames.length).toBe(count);
    expect(frames.at(-1)).toBeLessThan(40);
  });
});

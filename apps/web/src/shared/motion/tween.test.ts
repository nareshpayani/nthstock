import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RATCHET_GLIDE_MS, animateTween, easeOut } from './tween';

describe('easeOut', () => {
  it('runs 0 to 1, decelerating, and clamps outside that', () => {
    expect([easeOut(-1), easeOut(0), easeOut(1), easeOut(2)]).toEqual([0, 0, 1, 1]);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

describe('animateTween', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('jumps straight to the target when instant (reduced motion)', () => {
    const frames: number[] = [];
    const done = vi.fn();
    animateTween(0, 40, RATCHET_GLIDE_MS, (value) => frames.push(value), {
      instant: true,
      onDone: done,
    });
    expect(frames).toEqual([40]);
    expect(done).toHaveBeenCalledOnce();
  });

  it('glides in step towards the target and ends on it after its duration', () => {
    const frames: number[] = [];
    const done = vi.fn();
    animateTween(0, 40, RATCHET_GLIDE_MS, (value) => frames.push(value), { onDone: done });
    vi.advanceTimersByTime(RATCHET_GLIDE_MS / 2);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RATCHET_GLIDE_MS);
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.every((value, index) => index === 0 || value >= (frames[index - 1] ?? 0))).toBe(
      true,
    );
    expect(frames.at(-1)).toBe(40);
    expect(done).toHaveBeenCalledOnce();
  });

  it('stops where it is when cancelled', () => {
    const frames: number[] = [];
    const stop = animateTween(0, 40, RATCHET_GLIDE_MS, (value) => frames.push(value));
    vi.advanceTimersByTime(50);
    stop();
    const count = frames.length;
    vi.advanceTimersByTime(1_000);
    expect(frames.length).toBe(count);
    expect(frames.at(-1)).toBeLessThan(40);
  });

  it('stops from inside its own frame callback', () => {
    const frames: number[] = [];
    const stops: (() => void)[] = [];
    stops.push(
      animateTween(0, 40, RATCHET_GLIDE_MS, (value) => {
        frames.push(value);
        stops[0]?.();
      }),
    );
    vi.advanceTimersByTime(1_000);
    expect(frames).toHaveLength(1);
  });

  it('does not report done when stopped from inside the final frame', () => {
    const done = vi.fn();
    const stops: (() => void)[] = [];
    stops.push(
      animateTween(
        0,
        40,
        RATCHET_GLIDE_MS,
        (value) => {
          if (value === 40) stops[0]?.();
        },
        { onDone: done },
      ),
    );
    vi.advanceTimersByTime(1_000);
    expect(done).not.toHaveBeenCalled();
  });

  it.each([
    ['from equals to', 5, 5, 240],
    ['the duration is zero', 0, 5, 0],
  ])('lands on the target at once when %s', (_name, from, to, ms) => {
    const frames: number[] = [];
    const done = vi.fn();
    animateTween(from, to, ms, (value) => frames.push(value), { onDone: done });
    expect(frames).toEqual([to]);
    expect(done).toHaveBeenCalledOnce();
  });
});

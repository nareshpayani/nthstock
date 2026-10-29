import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from '@/shared/motion/useReducedMotion';
import {
  AUTO_SCROLL_CYCLES,
  AUTO_SCROLL_RECHECK_MS,
  AUTO_SCROLL_REST_MS,
  AUTO_SCROLL_SPEED,
  driftAt,
  useAutoScroll,
} from './useAutoScroll';

vi.mock('@/shared/motion/useReducedMotion', () => ({ prefersReducedMotion: vi.fn(() => false) }));

describe('driftAt (A21)', () => {
  const overflow = 200;
  const travel = (overflow / AUTO_SCROLL_SPEED) * 1000;

  it('rests at the start, drifts out, rests at the end and drifts back', () => {
    expect(driftAt(0, overflow)).toBe(0);
    expect(driftAt(AUTO_SCROLL_REST_MS + travel / 2, overflow)).toBeCloseTo(0.5);
    expect(driftAt(AUTO_SCROLL_REST_MS * 1.5 + travel, overflow)).toBe(1);
    expect(driftAt(AUTO_SCROLL_REST_MS * 2 + travel * 1.5, overflow)).toBeCloseTo(0.5);
  });

  it('does nothing when everything fits, and stops after its cycles', () => {
    expect(driftAt(1000, 0)).toBeNull();
    const cycle = 2 * (AUTO_SCROLL_REST_MS + travel);
    expect(driftAt(cycle * AUTO_SCROLL_CYCLES - 1, overflow)).not.toBeNull();
    expect(driftAt(cycle * AUTO_SCROLL_CYCLES, overflow)).toBeNull();
  });

  it('wraps into the next cycle', () => {
    const cycle = 2 * (AUTO_SCROLL_REST_MS + travel);
    expect(driftAt(cycle + 1, overflow)).toBe(0);
    expect(driftAt(cycle + AUTO_SCROLL_REST_MS + travel / 2, overflow)).toBeCloseTo(0.5);
  });

  it('is null for negative overflow', () => {
    expect(driftAt(0, -10)).toBeNull();
  });
});

describe('useAutoScroll (WCAG 2.2.2)', () => {
  const travel = (200 / AUTO_SCROLL_SPEED) * 1000;
  let now = 0;
  let callbacks: FrameRequestCallback[] = [];
  let el: HTMLDivElement | null = null;
  let scrollWidth = 400;

  const frame = (advance: number) => {
    now += advance;
    const run = callbacks;
    callbacks = [];
    act(() => run.forEach((cb) => cb(now)));
  };

  function Strip() {
    const ref = useAutoScroll<HTMLDivElement>();
    return createElement('div', {
      ref: (node: HTMLDivElement | null) => {
        if (node) {
          Object.defineProperty(node, 'scrollWidth', {
            get: () => scrollWidth,
            configurable: true,
          });
          Object.defineProperty(node, 'clientWidth', { value: 200, configurable: true });
        }
        el = node;
        ref.current = node;
      },
    });
  }

  beforeEach(() => {
    now = 0;
    callbacks = [];
    scrollWidth = 400;
    vi.mocked(prefersReducedMotion).mockReturnValue(false);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => callbacks.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {
      callbacks = [];
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('drifts to the end', () => {
    render(createElement(Strip));
    frame(1);
    // Frames over the hidden-page gap would not count, so step in small frames.
    for (let t = 0; t < AUTO_SCROLL_REST_MS + travel; t += 200) frame(200);
    expect(el?.scrollLeft).toBe(200);
  });

  it('does not drift under reduced motion', () => {
    vi.mocked(prefersReducedMotion).mockReturnValue(true);
    render(createElement(Strip));
    expect(callbacks).toHaveLength(0);
  });

  it.each(['pointerdown', 'wheel', 'focusin', 'keydown'])('stops on %s', (type) => {
    render(createElement(Strip));
    frame(1);
    expect(callbacks).toHaveLength(1);
    el?.dispatchEvent(new Event(type));
    expect(callbacks).toHaveLength(0);
  });

  it('cleans up on unmount', () => {
    const { unmount } = render(createElement(Strip));
    frame(1);
    unmount();
    expect(callbacks).toHaveLength(0);
  });

  it('stops after the last cycle', () => {
    render(createElement(Strip));
    frame(1);
    const cycle = 2 * (AUTO_SCROLL_REST_MS + travel);
    // A hidden-page gap is skipped, so step in sub-gap frames up to the end.
    for (let t = 0; t < cycle * AUTO_SCROLL_CYCLES + 500; t += 200) frame(200);
    expect(callbacks).toHaveLength(0);
  });

  it('waits on a slow timer while nothing overflows, then drifts once it does', () => {
    // Only the timers: the frames stay on the stub above.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    scrollWidth = 200;
    render(createElement(Strip));
    frame(1);
    // No frame loop while it waits.
    expect(callbacks).toHaveLength(0);
    act(() => vi.advanceTimersByTime(AUTO_SCROLL_RECHECK_MS));
    expect(callbacks).toHaveLength(1);
    scrollWidth = 400;
    vi.useRealTimers();
    frame(1);
    for (let t = 0; t < AUTO_SCROLL_REST_MS + travel; t += 200) frame(200);
    expect(el?.scrollLeft).toBe(200);
  });
});

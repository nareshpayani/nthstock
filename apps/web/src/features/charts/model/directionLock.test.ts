import type { IChartApi } from 'lightweight-charts';
import { describe, expect, it, vi } from 'vitest';
import { installDirectionLock, swipeAxis, ZOOM_STEP_PX } from './directionLock';

function fakeChart() {
  let options = {
    handleScroll: { horzTouchDrag: true } as unknown,
    handleScale: true as unknown,
    crosshair: { mode: 0 } as unknown,
  };
  const setVisibleLogicalRange = vi.fn();
  const chart = {
    options: () => options,
    applyOptions: vi.fn((next: typeof options) => {
      options = { ...options, ...next };
    }),
    timeScale: () => ({
      getVisibleLogicalRange: () => ({ from: 10, to: 50 }),
      setVisibleLogicalRange,
    }),
  };
  return { chart: chart as unknown as IChartApi, get: () => options, setVisibleLogicalRange };
}

function touch(
  host: HTMLElement,
  type: string,
  points: [number, number][],
  changed: [number, number][] = points,
): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  const list = (from: [number, number][]) =>
    from.map(([clientX, clientY]) => ({ clientX, clientY }));
  Object.defineProperty(event, 'touches', { value: list(points) });
  Object.defineProperty(event, 'changedTouches', { value: list(changed) });
  host.dispatchEvent(event);
  return event;
}

describe('swipeAxis (A13)', () => {
  it('waits for a real move, and gives ties to the page', () => {
    expect(swipeAxis(1, 1)).toBeNull();
    expect(swipeAxis(3, 3)).toBe('vertical');
    expect(swipeAxis(6, 2)).toBe('horizontal');
    expect(swipeAxis(-2, -9)).toBe('vertical');
  });
});

describe('installDirectionLock (A13)', () => {
  it('a vertical swipe scrolls the page: the chart stops panning and snaps back until lift', () => {
    const host = document.createElement('div');
    const { chart, get, setVisibleLogicalRange } = fakeChart();
    installDirectionLock(host, chart);
    touch(host, 'touchstart', [[100, 100]]);
    const move = touch(host, 'touchmove', [[102, 120]]);
    expect(move.defaultPrevented).toBe(false);
    expect(get().handleScroll).toBe(false);
    expect(get().handleScale).toBe(false);
    expect(setVisibleLogicalRange).toHaveBeenCalledWith({ from: 10, to: 50 });
    touch(host, 'touchend', [], [[102, 120]]);
    expect(get().handleScroll).toEqual({ horzTouchDrag: true });
    expect(get().handleScale).toBe(true);
  });

  it('a sideways swipe pans the chart and stops the page from scrolling', () => {
    const host = document.createElement('div');
    const { chart, get } = fakeChart();
    installDirectionLock(host, chart);
    touch(host, 'touchstart', [[100, 100]]);
    expect(touch(host, 'touchmove', [[120, 104]]).defaultPrevented).toBe(true);
    expect(touch(host, 'touchmove', [[130, 140]]).defaultPrevented).toBe(true);
    expect(get().handleScroll).toEqual({ horzTouchDrag: true });
  });

  it('leaves a two-finger pinch to the chart, and the teardown unhooks it', () => {
    const host = document.createElement('div');
    const { chart, get } = fakeChart();
    const teardown = installDirectionLock(host, chart);
    touch(host, 'touchstart', [
      [100, 100],
      [200, 200],
    ]);
    expect(
      touch(host, 'touchmove', [
        [90, 140],
        [210, 260],
      ]).defaultPrevented,
    ).toBe(false);
    teardown();
    touch(host, 'touchstart', [[100, 100]]);
    touch(host, 'touchmove', [[100, 130]]);
    expect(get().handleScroll).toEqual({ horzTouchDrag: true });
  });

  it('double-tap and slide zooms with one thumb: down zooms in, keeping the right edge', () => {
    const host = document.createElement('div');
    const { chart, get, setVisibleLogicalRange } = fakeChart();
    let clock = 0;
    installDirectionLock(host, chart, () => clock);
    touch(host, 'touchstart', [[100, 100]]);
    clock = 80;
    touch(host, 'touchend', [], [[101, 101]]);
    clock = 200;
    touch(host, 'touchstart', [[104, 102]]);
    expect(get().handleScroll).toBe(false);
    expect(get().crosshair).toEqual({ mode: 2 });
    const move = touch(host, 'touchmove', [[104, 102 + ZOOM_STEP_PX]]);
    expect(move.defaultPrevented).toBe(true);
    const zoomed = setVisibleLogicalRange.mock.lastCall?.[0] as { from: number; to: number };
    expect(zoomed.to).toBe(50);
    expect(zoomed.to - zoomed.from).toBeCloseTo(40 / 1.5);
    touch(host, 'touchend', [], [[104, 162]]);
    expect(get().handleScroll).toEqual({ horzTouchDrag: true });
    expect(get().crosshair).toEqual({ mode: 0 });
  });

  it('a slow second tap is just a new press, not a zoom', () => {
    const host = document.createElement('div');
    const { chart, get } = fakeChart();
    let clock = 0;
    installDirectionLock(host, chart, () => clock);
    touch(host, 'touchstart', [[100, 100]]);
    clock = 80;
    touch(host, 'touchend', [], [[100, 100]]);
    clock = 900;
    touch(host, 'touchstart', [[100, 100]]);
    expect(get().handleScroll).toEqual({ horzTouchDrag: true });
  });
});

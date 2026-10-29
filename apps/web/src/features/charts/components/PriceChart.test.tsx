import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartsMock } from '@/test/chartsMock';
import { makeCandles } from '@/test/candles';
import { installResizeObserver } from '@/test/resizeObserver';
import { PriceChart } from './PriceChart';

// Counts imports of the library itself (the test's own import of chartsMock does not count).
const library = vi.hoisted(() => ({ imports: 0 }));
vi.mock('lightweight-charts', () => {
  library.imports += 1;
  return import('@/test/chartsMock');
});

// The host appears on commit but the chart is created in a passive effect, which React may flush
// later under load; wait for the chart itself so the test never outlives its ResizeObserver stub.
async function chartMounted() {
  await screen.findByTestId('chart-host');
  await waitFor(() => expect(chartsMock.charts.length).toBeGreaterThan(0));
}

let resize: ReturnType<typeof installResizeObserver>;

beforeEach(() => {
  resize = installResizeObserver();
  chartsMock.reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PriceChart (T-094)', () => {
  it('loads the charts library only when a chart first renders', async () => {
    expect(library.imports).toBe(0);
    const candles = makeCandles({ count: 3 });
    render(<PriceChart candles={candles} label="INFY chart" />);
    expect(screen.getByRole('status', { name: 'Loading chart' })).toBeInTheDocument();
    await chartMounted();
    expect(library.imports).toBe(1);
    expect(chartsMock.charts).toHaveLength(1);
  });

  it('draws an area series from the candles, coloured by direction', async () => {
    const candles = makeCandles({ count: 3, step: -100 });
    render(<PriceChart candles={candles} label="INFY chart" format="inr" height={200} />);
    await chartMounted();
    const [chart] = chartsMock.charts;
    const series = chart?.series[0];
    expect(series?.type).toBe('Area');
    expect(series?.setData).toHaveBeenCalledWith(
      candles.map((c) => ({ time: Date.parse(c.t) / 1000, value: c.c })),
    );
    expect(chart?.fitContent).toHaveBeenCalled();
    expect(series?.applyOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ lineColor: expect.any(String) as string }),
    );
    expect(screen.getByRole('figure', { name: 'INFY chart' })).toHaveTextContent(
      /From ₹25,001.00 on 25 Sept 2026 to ₹24,997.00 on 25 Sept 2026/,
    );
  });

  it('draws candlesticks when asked', async () => {
    render(<PriceChart candles={makeCandles({ count: 2 })} label="c" type="candle" />);
    await chartMounted();
    expect(chartsMock.charts[0]?.series[0]?.type).toBe('Candlestick');
    expect(chartsMock.charts[0]?.series[0]?.setData).toHaveBeenCalledWith([
      expect.objectContaining({ open: expect.any(Number) as number }),
      expect.objectContaining({ close: expect.any(Number) as number }),
    ]);
  });

  it('follows the container width through a ResizeObserver', async () => {
    render(<PriceChart candles={makeCandles({ count: 2 })} label="c" height={180} />);
    await chartMounted();
    act(() => resize.resize(640.6));
    expect(chartsMock.charts[0]?.resize).toHaveBeenCalledWith(640, 180);
    act(() => resize.resize(0));
    expect(chartsMock.charts[0]?.resize).toHaveBeenCalledTimes(1);
  });

  it('resizes the same chart to a new height instead of building another (NSTOCK-0461)', async () => {
    const view = render(<PriceChart candles={makeCandles({ count: 2 })} label="c" height={180} />);
    await chartMounted();
    view.rerender(<PriceChart candles={makeCandles({ count: 2 })} label="c" height={240} />);
    expect(chartsMock.charts).toHaveLength(1);
    expect(chartsMock.charts[0]?.resize).toHaveBeenCalledWith(expect.any(Number), 240);
  });

  it('updates the same chart when candles change instead of creating another', async () => {
    const view = render(<PriceChart candles={makeCandles({ count: 2 })} label="c" />);
    await chartMounted();
    const next = makeCandles({ count: 4 });
    view.rerender(<PriceChart candles={next} label="c" />);
    expect(chartsMock.charts).toHaveLength(1);
    expect(chartsMock.charts[0]?.series[0]?.setData).toHaveBeenLastCalledWith(
      next.map((c) => ({ time: Date.parse(c.t) / 1000, value: c.c })),
    );
  });

  it('fits prices again for new candles but keeps a price zoom on a live tick (NSTOCK-0436)', async () => {
    const first = makeCandles({ count: 3 });
    const view = render(<PriceChart candles={first} label="c" />);
    await chartMounted();
    chartsMock.scale.autoScale = false;
    const last = first.at(-1);
    if (!last) throw new Error('no candles');
    view.rerender(
      <PriceChart candles={[...first.slice(0, -1), { ...last, c: last.c + 5 }]} label="c" />,
    );
    expect(chartsMock.scale.autoScale).toBe(false);
    view.rerender(<PriceChart candles={makeCandles({ count: 5, step: -100 })} label="c" />);
    expect(chartsMock.scale.autoScale).toBe(true);
  });

  it('removes the chart and disconnects the observer on unmount', async () => {
    const view = render(<PriceChart candles={makeCandles({ count: 2 })} label="c" />);
    await chartMounted();
    expect(chartsMock.active()).toHaveLength(1);
    expect(resize.observers.size).toBe(1);
    view.unmount();
    expect(chartsMock.active()).toHaveLength(0);
    expect(chartsMock.charts[0]?.remove).toHaveBeenCalledTimes(1);
    expect(resize.observers.size).toBe(0);
  });

  it('shows a text empty state and no chart for empty candles', () => {
    render(<PriceChart candles={[]} label="c" />);
    expect(screen.getByRole('figure', { name: 'c' })).toHaveTextContent(
      'No chart data for this range yet.',
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(chartsMock.charts).toHaveLength(0);
  });
});

describe('PriceChart live tick glide (A16)', () => {
  const START = 1000;
  let frames: Map<number, FrameRequestCallback>;
  let cancelled: number[];
  let nextId: number;

  beforeEach(() => {
    frames = new Map();
    cancelled = [];
    nextId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextId += 1;
      frames.set(nextId, callback);
      return nextId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelled.push(id);
      frames.delete(id);
    });
    vi.spyOn(performance, 'now').mockReturnValue(START);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Runs the one pending frame at `elapsed` ms after the glide started. */
  function runFrame(elapsed: number) {
    const [id, callback] = [...frames.entries()][0] ?? [];
    if (id === undefined || !callback) throw new Error('no frame pending');
    frames.delete(id);
    act(() => callback(START + elapsed));
  }

  function reducedMotionOn() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  }

  const base = makeCandles({ count: 3 });
  const lastOf = (list: typeof base) => {
    const last = list.at(-1);
    if (!last) throw new Error('no candles');
    return last;
  };
  const moved = (by: number) => [...base.slice(0, -1), { ...lastOf(base), c: lastOf(base).c + by }];
  const from = lastOf(base).c;

  async function mounted(type?: 'candle' | 'heikin') {
    const view = render(<PriceChart candles={base} label="c" {...(type ? { type } : {})} />);
    await chartMounted();
    const series = chartsMock.charts[0]?.series[0];
    if (!series) throw new Error('no series');
    return { view, series };
  }

  it('eases the last point to the new close over the next frames', async () => {
    const { view, series } = await mounted();
    view.rerender(<PriceChart candles={moved(4000)} label="c" />);
    expect(series.update).not.toHaveBeenCalled();
    runFrame(80);
    const mid = (series.update.mock.lastCall?.[0] as { value: number }).value;
    expect(mid).toBeGreaterThan(from);
    expect(mid).toBeLessThan(from + 4000);
    runFrame(160);
    expect(series.update.mock.lastCall?.[0]).toMatchObject({ value: from + 4000 });
    expect(frames.size).toBe(0);
  });

  it('pulses the line end on a live update, and not on bars or under reduced motion', async () => {
    const { series } = await mounted();
    expect(series.applyOptions).toHaveBeenCalledWith({ lastPriceAnimation: 2 });
    cleanup();
    chartsMock.reset();
    const bars = await mounted('candle');
    expect(bars.series.applyOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({ lastPriceAnimation: expect.anything() as unknown }),
    );
    cleanup();
    chartsMock.reset();
    reducedMotionOn();
    const calm = await mounted();
    expect(calm.series.applyOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({ lastPriceAnimation: expect.anything() as unknown }),
    );
  });

  it('jumps at once under reduced motion', async () => {
    reducedMotionOn();
    const { view, series } = await mounted();
    view.rerender(<PriceChart candles={moved(4000)} label="c" />);
    expect(series.update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ value: from + 4000 }),
    );
    expect(frames.size).toBe(0);
  });

  it('draws a new bar at once, with no glide', async () => {
    const { view, series } = await mounted();
    const last = lastOf(base);
    const next = { ...last, t: new Date(Date.parse(last.t) + 60_000).toISOString(), c: last.c + 9 };
    view.rerender(<PriceChart candles={[...base, next]} label="c" />);
    expect(series.update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ value: from + 9 }),
    );
    expect(frames.size).toBe(0);
  });

  it('draws Heikin-Ashi at once, with no glide', async () => {
    const { view, series } = await mounted('heikin');
    view.rerender(<PriceChart candles={moved(4000)} type="heikin" label="c" />);
    expect(series.update).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('a second tick mid-glide cancels the frame, finishes the first target and glides on', async () => {
    const { view, series } = await mounted();
    view.rerender(<PriceChart candles={moved(4000)} label="c" />);
    runFrame(80);
    const first = [...frames.keys()][0];
    view.rerender(<PriceChart candles={moved(6000)} label="c" />);
    expect(cancelled).toContain(first);
    // The cut glide's bar is written at its target before the next glide starts.
    expect(series.update.mock.lastCall?.[0]).toMatchObject({ value: from + 4000 });
    expect(frames.size).toBe(1);
    runFrame(160);
    expect(series.update.mock.lastCall?.[0]).toMatchObject({ value: from + 6000 });
  });

  it('cancels the pending frame on unmount', async () => {
    const { view } = await mounted();
    view.rerender(<PriceChart candles={moved(4000)} label="c" />);
    const pending = [...frames.keys()][0];
    view.unmount();
    expect(cancelled).toContain(pending);
    expect(frames.size).toBe(0);
  });
});

describe('PriceChart disposal (T-113)', () => {
  it('replaces the chart when the type changes: one live chart and one observer', async () => {
    const candles = makeCandles({ count: 3 });
    const view = render(<PriceChart candles={candles} label="c" type="area" />);
    await chartMounted();
    view.rerender(<PriceChart candles={candles} label="c" type="candle" />);
    expect(chartsMock.charts).toHaveLength(2);
    expect(chartsMock.charts[0]?.removed).toBe(true);
    expect(chartsMock.active()).toHaveLength(1);
    expect(chartsMock.active()[0]?.series[0]?.type).toBe('Candlestick');
    expect(resize.observers.size).toBe(1);
    view.unmount();
    expect(chartsMock.active()).toHaveLength(0);
    expect(resize.observers.size).toBe(0);
  });

  it('disposes the chart when the candles become empty', async () => {
    const view = render(<PriceChart candles={makeCandles({ count: 3 })} label="c" />);
    await chartMounted();
    view.rerender(<PriceChart candles={[]} label="c" />);
    expect(screen.getByRole('figure', { name: 'c' })).toHaveTextContent(
      'No chart data for this range yet.',
    );
    expect(screen.queryByTestId('chart-host')).toBeNull();
    expect(chartsMock.active()).toHaveLength(0);
    expect(resize.observers.size).toBe(0);
  });

  it('unsubscribes the tooltip crosshair handler on unmount', async () => {
    const view = render(<PriceChart candles={makeCandles({ count: 3 })} label="c" tooltip />);
    await chartMounted();
    const [chart] = chartsMock.charts;
    expect(chart?.crosshair.size).toBe(1);
    view.unmount();
    expect(chart?.crosshair.size).toBe(0);
    expect(chartsMock.active()).toHaveLength(0);
    expect(resize.observers.size).toBe(0);
  });

  it('leaves exactly one chart after a StrictMode mount, unmount and remount, and none after', async () => {
    const view = render(
      <StrictMode>
        <PriceChart candles={makeCandles({ count: 3 })} label="c" tooltip />
      </StrictMode>,
    );
    await chartMounted();
    expect(chartsMock.active()).toHaveLength(1);
    expect(resize.observers.size).toBe(1);
    view.unmount();
    expect(chartsMock.active()).toHaveLength(0);
    expect(resize.observers.size).toBe(0);
    for (const chart of chartsMock.charts) expect(chart.crosshair.size).toBe(0);
  });

  it('creates no chart when unmounted before the lazy chunk has loaded', async () => {
    // A fresh module graph, so the lazy import is still pending on first render.
    vi.resetModules();
    const { PriceChart: FreshPriceChart } = await import('./PriceChart');
    const { chartsMock: freshMock } = await import('@/test/chartsMock');
    const view = render(<FreshPriceChart candles={makeCandles({ count: 3 })} label="c" />);
    expect(screen.getByRole('status', { name: 'Loading chart' })).toBeInTheDocument();
    view.unmount();
    await vi.dynamicImportSettled();
    expect(freshMock.charts).toHaveLength(0);
    expect(chartsMock.charts).toHaveLength(0);
    expect(resize.observers.size).toBe(0);
  });
  it('pans and pinches for trading, and hands the chart to an overlay until it is removed (T15)', async () => {
    const onReady = vi.fn();
    const candles = makeCandles({ count: 3 });
    const { rerender, unmount } = render(
      <PriceChart
        candles={candles}
        label="INFY chart"
        interactive
        onReady={onReady}
        overlay={<div data-testid="overlay" />}
      />,
    );
    await chartMounted();
    const [chart] = chartsMock.charts;
    expect(chart?.options).toMatchObject({
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false },
      handleScale: {
        pinch: true,
        axisPressedMouseMove: { price: true },
        axisDoubleClickReset: false,
      },
      rightPriceScale: { minimumWidth: 64, borderColor: expect.any(String) as string },
    });
    expect(screen.getByTestId('overlay')).toBeInTheDocument();
    expect(onReady).toHaveBeenLastCalledWith(
      expect.objectContaining({ series: chart?.series[0], host: screen.getByTestId('chart-host') }),
    );
    // A new callback identity does not rebuild the chart.
    const next = vi.fn();
    rerender(<PriceChart candles={candles} label="INFY chart" interactive onReady={next} />);
    expect(chartsMock.charts).toHaveLength(1);
    unmount();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledExactlyOnceWith(null);
  });

  describe('one direction per swipe (NSTOCK-0452)', () => {
    function touch(host: HTMLElement, type: string, x: number, y: number): TouchEvent {
      const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
      const points = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
      Object.defineProperty(event, 'touches', { value: points });
      Object.defineProperty(event, 'changedTouches', { value: [{ clientX: x, clientY: y }] });
      host.dispatchEvent(event);
      return event;
    }

    it('an interactive chart locks its pan on a vertical swipe and gives it back on lift', async () => {
      render(<PriceChart candles={makeCandles({ count: 3 })} label="c" interactive />);
      await chartMounted();
      const host = screen.getByTestId('chart-host');
      const chart = chartsMock.charts[0];
      touch(host, 'touchstart', 100, 100);
      touch(host, 'touchmove', 102, 130);
      expect(chart?.options).toMatchObject({ handleScroll: false, handleScale: false });
      touch(host, 'touchend', 102, 130);
      expect(chart?.options).toMatchObject({
        handleScroll: { horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { pinch: true },
      });
    });

    it('a sideways swipe on an interactive chart keeps the page from scrolling', async () => {
      render(<PriceChart candles={makeCandles({ count: 3 })} label="c" interactive />);
      await chartMounted();
      const host = screen.getByTestId('chart-host');
      touch(host, 'touchstart', 100, 100);
      expect(touch(host, 'touchmove', 130, 102).defaultPrevented).toBe(true);
    });

    it('a plain chart installs no touch handling', async () => {
      render(<PriceChart candles={makeCandles({ count: 3 })} label="c" />);
      await chartMounted();
      const host = screen.getByTestId('chart-host');
      touch(host, 'touchstart', 100, 100);
      expect(touch(host, 'touchmove', 130, 102).defaultPrevented).toBe(false);
    });

    it('unhooks on unmount: a later touch does nothing', async () => {
      const view = render(<PriceChart candles={makeCandles({ count: 3 })} label="c" interactive />);
      await chartMounted();
      const host = screen.getByTestId('chart-host');
      const chart = chartsMock.charts[0];
      view.unmount();
      const before = chart?.options;
      touch(host, 'touchstart', 100, 100);
      expect(touch(host, 'touchmove', 130, 102).defaultPrevented).toBe(false);
      touch(host, 'touchmove', 102, 140);
      expect(chart?.options).toBe(before);
    });
  });

  it('keeps the plain chart static', async () => {
    render(<PriceChart candles={makeCandles({ count: 3 })} label="INFY chart" />);
    await chartMounted();
    expect(chartsMock.charts[0]?.options).toMatchObject({
      handleScroll: false,
      handleScale: false,
    });
  });
});

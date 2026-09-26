import { act, render, screen } from '@testing-library/react';
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
    await screen.findByTestId('chart-host');
    expect(library.imports).toBe(1);
    expect(chartsMock.charts).toHaveLength(1);
  });

  it('draws an area series from the candles, coloured by direction', async () => {
    const candles = makeCandles({ count: 3, step: -100 });
    render(<PriceChart candles={candles} label="INFY chart" format="inr" height={200} />);
    await screen.findByTestId('chart-host');
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
    await screen.findByTestId('chart-host');
    expect(chartsMock.charts[0]?.series[0]?.type).toBe('Candlestick');
    expect(chartsMock.charts[0]?.series[0]?.setData).toHaveBeenCalledWith([
      expect.objectContaining({ open: expect.any(Number) as number }),
      expect.objectContaining({ close: expect.any(Number) as number }),
    ]);
  });

  it('follows the container width through a ResizeObserver', async () => {
    render(<PriceChart candles={makeCandles({ count: 2 })} label="c" height={180} />);
    await screen.findByTestId('chart-host');
    act(() => resize.resize(640.6));
    expect(chartsMock.charts[0]?.resize).toHaveBeenCalledWith(640, 180);
    act(() => resize.resize(0));
    expect(chartsMock.charts[0]?.resize).toHaveBeenCalledTimes(1);
  });

  it('updates the same chart when candles change instead of creating another', async () => {
    const view = render(<PriceChart candles={makeCandles({ count: 2 })} label="c" />);
    await screen.findByTestId('chart-host');
    const next = makeCandles({ count: 4 });
    view.rerender(<PriceChart candles={next} label="c" />);
    expect(chartsMock.charts).toHaveLength(1);
    expect(chartsMock.charts[0]?.series[0]?.setData).toHaveBeenLastCalledWith(
      next.map((c) => ({ time: Date.parse(c.t) / 1000, value: c.c })),
    );
  });

  it('removes the chart and disconnects the observer on unmount', async () => {
    const view = render(<PriceChart candles={makeCandles({ count: 2 })} label="c" />);
    await screen.findByTestId('chart-host');
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

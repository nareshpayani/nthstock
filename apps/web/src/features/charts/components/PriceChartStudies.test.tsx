import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chartsMock } from '@/test/chartsMock';
import { makeCandles } from '@/test/candles';
import { installResizeObserver } from '@/test/resizeObserver';
import { PriceChart } from './PriceChart';

vi.mock('lightweight-charts', () => import('@/test/chartsMock'));

async function chartMounted() {
  await screen.findByTestId('chart-host');
  await waitFor(() => expect(chartsMock.active().length).toBeGreaterThan(0));
}
const seriesOf = (type: string) =>
  chartsMock.active()[0]?.series.filter((series) => series.type === type) ?? [];

beforeEach(() => {
  installResizeObserver();
  chartsMock.reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PriceChart studies (NSTOCK-0460)', () => {
  it('adds a volume histogram with a bar per candle, and removes it when switched off', async () => {
    const candles = makeCandles({ count: 4 });
    const view = render(<PriceChart candles={candles} label="c" studies={['volume']} />);
    await chartMounted();
    await waitFor(() => expect(seriesOf('Histogram')).toHaveLength(1));
    const bars = seriesOf('Histogram')[0]?.setData.mock.calls.at(-1)?.[0] as { value: number }[];
    expect(bars.map((bar) => bar.value)).toEqual(candles.map((c) => c.v));
    view.rerender(<PriceChart candles={candles} label="c" studies={[]} />);
    expect(seriesOf('Histogram')).toHaveLength(0);
  });

  it('draws no volume bars when no candle has volume', async () => {
    const candles = makeCandles({ count: 4 }).map((c) => ({ ...c, v: 0 }));
    render(<PriceChart candles={candles} label="c" studies={['volume']} />);
    await chartMounted();
    expect(seriesOf('Histogram')).toHaveLength(0);
  });

  it('adds a line per picked indicator and removes it when unpicked', async () => {
    const candles = makeCandles({ count: 30 });
    const view = render(<PriceChart candles={candles} label="c" studies={['sma20']} />);
    await chartMounted();
    await waitFor(() => expect(seriesOf('Line')).toHaveLength(1));
    // 30 bars and a 20-bar average: 11 points.
    expect(seriesOf('Line')[0]?.setData.mock.calls.at(-1)?.[0]).toHaveLength(11);
    view.rerender(<PriceChart candles={candles} label="c" studies={['sma20', 'ema20']} />);
    expect(seriesOf('Line')).toHaveLength(2);
    view.rerender(<PriceChart candles={candles} label="c" studies={['ema20']} />);
    expect(seriesOf('Line')).toHaveLength(1);
  });

  it('keeps the last bar in the legend when the crosshair time matches no candle', async () => {
    const candles = makeCandles({ count: 4 });
    render(<PriceChart candles={candles} label="c" legend studies={['volume']} />);
    await chartMounted();
    const legend = await screen.findByTestId('chart-legend');
    expect(legend).toHaveTextContent('1K');
    act(() =>
      chartsMock.moveCrosshair({ time: Date.parse('2030-01-01T00:00:00.000Z') / 1000, value: 1 }),
    );
    expect(screen.getByTestId('chart-legend')).toHaveTextContent('1K');
  });
});

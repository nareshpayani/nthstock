import { vi } from 'vitest';

/**
 * A stand-in for `lightweight-charts` in jsdom (no canvas). Use it with
 * `vi.mock('lightweight-charts', () => import('@/test/chartsMock'))` and inspect `chartsMock`.
 */
type FakeSeries = {
  type: 'Area' | 'Candlestick';
  setData: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  seriesType: () => 'Area' | 'Candlestick';
};
type FakeChart = {
  options: unknown;
  series: FakeSeries[];
  resize: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  fitContent: ReturnType<typeof vi.fn>;
  removed: boolean;
  /** Crosshair handlers currently subscribed. */
  crosshair: Set<(param: unknown) => void>;
};

export const chartsMock = {
  charts: [] as FakeChart[],
  reset() {
    this.charts.length = 0;
  },
  /** Charts created and not yet removed. */
  active(): FakeChart[] {
    return this.charts.filter((chart) => !chart.removed);
  },
  /**
   * Moves the crosshair of the latest live chart to `x` over `item` (a data item of its first
   * series), or off the chart when `item` is null, as the library would on mouse move.
   */
  moveCrosshair(item: ({ time: number } & Record<string, number>) | null, x = 40) {
    const chart = this.active().at(-1);
    if (!chart) throw new Error('No active chart');
    const series = chart.series[0];
    const param = item
      ? { time: item.time, point: { x, y: 20 }, seriesData: new Map([[series, item]]) }
      : { seriesData: new Map() };
    for (const handler of chart.crosshair) handler(param);
  },
};

export const AreaSeries = { type: 'Area' as const };
export const CandlestickSeries = { type: 'Candlestick' as const };
export const ColorType = { Solid: 'solid' };
export const CrosshairMode = { Normal: 0, Magnet: 1 };
export const TickMarkType = { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 };

export function createChart(_host: HTMLElement, options: unknown) {
  const chart: FakeChart = {
    options,
    series: [],
    resize: vi.fn(),
    remove: vi.fn(() => {
      chart.removed = true;
    }),
    fitContent: vi.fn(),
    removed: false,
    crosshair: new Set(),
  };
  chartsMock.charts.push(chart);
  return {
    addSeries(definition: { type: 'Area' | 'Candlestick' }) {
      const series: FakeSeries = {
        type: definition.type,
        setData: vi.fn(),
        update: vi.fn(),
        applyOptions: vi.fn(),
        seriesType: () => definition.type,
      };
      chart.series.push(series);
      return series;
    },
    resize: chart.resize,
    remove: chart.remove,
    subscribeCrosshairMove: (handler: (param: unknown) => void) => chart.crosshair.add(handler),
    unsubscribeCrosshairMove: (handler: (param: unknown) => void) =>
      chart.crosshair.delete(handler),
    timeScale: () => ({ fitContent: chart.fitContent }),
  };
}

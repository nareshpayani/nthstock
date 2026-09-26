import { vi } from 'vitest';

/**
 * A stand-in for `lightweight-charts` in jsdom (no canvas). Use it with
 * `vi.mock('lightweight-charts', () => import('@/test/chartsMock'))` and inspect `chartsMock`.
 */
type FakeSeries = {
  type: 'Area' | 'Candlestick';
  setData: ReturnType<typeof vi.fn>;
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
  };
  chartsMock.charts.push(chart);
  return {
    addSeries(definition: { type: 'Area' | 'Candlestick' }) {
      const series: FakeSeries = {
        type: definition.type,
        setData: vi.fn(),
        applyOptions: vi.fn(),
        seriesType: () => definition.type,
      };
      chart.series.push(series);
      return series;
    },
    resize: chart.resize,
    remove: chart.remove,
    timeScale: () => ({ fitContent: chart.fitContent }),
  };
}

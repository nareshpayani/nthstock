import { vi } from 'vitest';

type MockSeriesType = 'Area' | 'Candlestick' | 'Line' | 'Bar' | 'Histogram';

/**
 * A stand-in for `lightweight-charts` in jsdom (no canvas). Use it with
 * `vi.mock('lightweight-charts', () => import('@/test/chartsMock'))` and inspect `chartsMock`.
 */
type FakePriceLine = {
  options: Record<string, unknown>;
  removed: boolean;
  applyOptions: (o: object) => void;
};
type FakePrimitive = { attached?: (param: unknown) => void; updateAllViews?: () => void };
type FakeSeries = {
  type: MockSeriesType;
  setData: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  seriesType: () => MockSeriesType;
  /** Price lines currently drawn. */
  priceLines: FakePriceLine[];
  primitives: FakePrimitive[];
  createPriceLine: (options: Record<string, unknown>) => FakePriceLine;
  removePriceLine: (line: FakePriceLine) => void;
  attachPrimitive: (primitive: FakePrimitive) => void;
  detachPrimitive: (primitive: FakePrimitive) => void;
  priceToCoordinate: (price: number) => number | null;
  coordinateToPrice: (y: number) => number | null;
  priceScale: () => { applyOptions: ReturnType<typeof vi.fn> };
  /** Options the series was added with (studies are told apart by these). */
  addedWith: Record<string, unknown> | undefined;
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
  /** The visible logical range; a pan moves it. */
  logicalRange: { from: number; to: number };
};

/**
 * The fake price scale: `top` paise sits at y = 0 and each px is `paisePerPx` lower, over a pane
 * `height` px tall with a `axisWidth` px price axis. Change it and call `repaint()` to stand in
 * for a pan, pinch or autoscale. `autoScale` turns off when a price-axis zoom sets the range.
 */
const DEFAULT_SCALE = { top: 160_000, paisePerPx: 50, height: 300, axisWidth: 64, autoScale: true };

export const chartsMock = {
  charts: [] as FakeChart[],
  scale: { ...DEFAULT_SCALE },
  reset() {
    this.charts.length = 0;
    this.scale = { ...DEFAULT_SCALE };
  },
  /** Repaints the latest live chart, as the library does on a tick, pan or autoscale. */
  repaint() {
    const chart = this.active().at(-1);
    for (const series of chart?.series ?? []) {
      for (const primitive of series.primitives) primitive.updateAllViews?.();
    }
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
export const LineSeries = { type: 'Line' as const };
export const BarSeries = { type: 'Bar' as const };
export const HistogramSeries = { type: 'Histogram' as const };
export const LastPriceAnimationMode = { Disabled: 0, Continuous: 1, OnDataUpdate: 2 };
export const ColorType = { Solid: 'solid' };
export const CrosshairMode = { Normal: 0, Magnet: 1, Hidden: 2 };
export const TickMarkType = { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 };

export function createChart(_host: HTMLElement, options: unknown) {
  const chart: FakeChart = {
    // The library's defaults under what the caller passed, as `chart.options()` returns them.
    options: {
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: true,
      handleScale: true,
      ...(options as Record<string, unknown>),
    },
    series: [],
    resize: vi.fn(),
    remove: vi.fn(() => {
      chart.removed = true;
    }),
    fitContent: vi.fn(),
    removed: false,
    crosshair: new Set(),
    logicalRange: { from: 0, to: 60 },
  };
  chartsMock.charts.push(chart);
  return {
    addSeries(definition: { type: MockSeriesType }, addedWith?: Record<string, unknown>) {
      const series: FakeSeries = {
        type: definition.type,
        addedWith,
        priceScale: () => ({ applyOptions: vi.fn() }),
        setData: vi.fn(),
        update: vi.fn(),
        applyOptions: vi.fn(),
        seriesType: () => definition.type,
        priceLines: [],
        primitives: [],
        createPriceLine: (options) => {
          const line: FakePriceLine = {
            options: { ...options },
            removed: false,
            // The real library throws when a removed line is written to.
            applyOptions: (next) => {
              if (line.removed) throw new Error('Value is undefined');
              Object.assign(line.options, next);
            },
          };
          series.priceLines.push(line);
          return line;
        },
        removePriceLine: (line) => {
          line.removed = true;
          series.priceLines = series.priceLines.filter((drawn) => drawn !== line);
        },
        attachPrimitive: (primitive) => {
          series.primitives.push(primitive);
          primitive.attached?.({ requestUpdate: () => chartsMock.repaint() });
        },
        detachPrimitive: (primitive) => {
          series.primitives = series.primitives.filter((attached) => attached !== primitive);
        },
        priceToCoordinate: (price) => (chartsMock.scale.top - price) / chartsMock.scale.paisePerPx,
        coordinateToPrice: (y) => chartsMock.scale.top - y * chartsMock.scale.paisePerPx,
      };
      chart.series.push(series);
      return series;
    },
    removeSeries: (series: FakeSeries) => {
      chart.series = chart.series.filter((drawn) => drawn !== series);
    },
    resize: chart.resize,
    remove: chart.remove,
    options: () => chart.options,
    applyOptions: (next: Record<string, unknown>) => {
      chart.options = { ...(chart.options as Record<string, unknown>), ...next };
    },
    clearCrosshairPosition: vi.fn(),
    subscribeCrosshairMove: (handler: (param: unknown) => void) => chart.crosshair.add(handler),
    unsubscribeCrosshairMove: (handler: (param: unknown) => void) =>
      chart.crosshair.delete(handler),
    timeScale: () => ({
      fitContent: chart.fitContent,
      options: () => ({ barSpacing: 10 }),
      getVisibleLogicalRange: () => ({ ...chart.logicalRange }),
      setVisibleLogicalRange: (range: { from: number; to: number }) => {
        chart.logicalRange = { ...range };
      },
    }),
    paneSize: () => ({ height: chartsMock.scale.height, width: 600 }),
    priceScale: () => ({
      width: () => chartsMock.scale.axisWidth,
      options: () => ({ autoScale: chartsMock.scale.autoScale }),
      getVisibleRange: () => {
        const { top, paisePerPx, height } = chartsMock.scale;
        return { from: top - height * paisePerPx, to: top };
      },
      setVisibleRange: (range: { from: number; to: number }) => {
        chartsMock.scale.top = range.to;
        chartsMock.scale.paisePerPx = (range.to - range.from) / chartsMock.scale.height;
        chartsMock.scale.autoScale = false;
      },
      setAutoScale: (on: boolean) => {
        chartsMock.scale.autoScale = on;
      },
      applyOptions: vi.fn(),
    }),
  };
}

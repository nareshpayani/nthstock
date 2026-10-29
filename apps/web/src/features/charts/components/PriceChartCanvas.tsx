import type { Candle } from '@nthstock/contracts';
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  LineSeries,
  createChart,
  type BarData,
  type IChartApi,
  type LineData,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { cn } from '@nthstock/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toAreaData, toCandleData, toChartTime, toHeikinAshi } from '../model/chartData';
import { trailingChanges } from '../model/liveCandles';
import type { ChartDirection, ChartValueFormat } from '../model/chartFormat';
import {
  TRADING_INTERACTION,
  areaSeriesOptions,
  barSeriesOptions,
  candleSeriesOptions,
  chartOptions,
  lineSeriesOptions,
} from '../model/chartTheme';
import { isBarType, type PriceChartType } from '../model/chartTypes';
import { tooltipContent, type HoveredItem } from '../model/chartTooltip';
import { ChartTooltip, type ChartTooltipState } from './ChartTooltip';

export type PriceChartCanvasProps = {
  candles: readonly Candle[];
  type: PriceChartType;
  format: ChartValueFormat;
  direction: ChartDirection;
  intraday: boolean;
  height: number;
  /** Show the crosshair tooltip (IST time and ₹ values of the hovered bar). */
  tooltip?: boolean;
  /** Pan and zoom (SPEC-TFC-1 §10.5); a chart is static without it. */
  interactive?: boolean;
  /**
   * The chart and its series once created, for an overlay that draws on it (T15); null when they
   * are removed. Called again whenever the chart is rebuilt (a new type, range or height).
   */
  onReady?: ((handle: ChartHandle | null) => void) | undefined;
};

type AnySeries =
  ISeriesApi<'Area'> | ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | ISeriesApi<'Bar'>;

function addSeries(chart: IChartApi, type: PriceChartType, format: ChartValueFormat): AnySeries {
  switch (type) {
    case 'line':
      return chart.addSeries(LineSeries, lineSeriesOptions('flat', format));
    case 'candle':
      return chart.addSeries(CandlestickSeries, candleSeriesOptions(format));
    case 'heikin':
      return chart.addSeries(CandlestickSeries, candleSeriesOptions(format, { smoothed: true }));
    case 'bar':
      return chart.addSeries(BarSeries, barSeriesOptions(format));
    default:
      return chart.addSeries(AreaSeries, areaSeriesOptions('flat', format));
  }
}

/** The series' points for a type: closes for line and area, bars (or Heikin-Ashi) otherwise. */
function seriesData(
  type: PriceChartType,
  candles: readonly Candle[],
): (LineData<UTCTimestamp> | BarData<UTCTimestamp>)[] {
  if (type === 'heikin') return toCandleData(toHeikinAshi(candles));
  return isBarType(type) ? toCandleData(candles) : toAreaData(candles);
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** What an overlay needs to draw on the chart: the chart, its one series, and the host element. */
export type ChartHandle = { chart: IChartApi; series: AnySeries; host: HTMLElement };

/**
 * The Lightweight Charts canvas (T-094). Loaded only through PriceChart's lazy import, so the
 * library never reaches the initial bundle. One chart per mount: a ResizeObserver keeps its width
 * in step with the card, and unmounting disconnects the observer and removes the chart.
 */
export function PriceChartCanvas({
  candles,
  type,
  format,
  direction,
  intraday,
  height,
  tooltip = false,
  interactive = false,
  onReady,
}: PriceChartCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<AnySeries | null>(null);
  const drawnRef = useRef<{ series: AnySeries; candles: readonly Candle[] } | null>(null);
  // The real bars by time, so the Heikin-Ashi tooltip shows traded prices, not smoothed ones.
  const realRef = useRef<ReadonlyMap<number, Candle>>(new Map());
  // The type last drawn, so a switch (not the first draw) cross-fades in.
  const builtTypeRef = useRef<PriceChartType | null>(null);
  const [hover, setHover] = useState<ChartTooltipState | null>(null);
  // Kept in a ref so a new callback identity never rebuilds the chart.
  const onReadyRef = useRef(onReady);
  useLayoutEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const base = chartOptions({ format, intraday });
    const chart = createChart(host, {
      ...base,
      ...(interactive
        ? {
            ...TRADING_INTERACTION,
            rightPriceScale: { ...base.rightPriceScale, ...TRADING_INTERACTION.rightPriceScale },
          }
        : {}),
      width: Math.floor(host.clientWidth),
      height,
    });
    chartRef.current = chart;
    seriesRef.current = addSeries(chart, type, format);
    // A new chart type fades in over 160 ms (NSTOCK-0430); the overlay above it does not move.
    const switched = builtTypeRef.current !== null && builtTypeRef.current !== type;
    builtTypeRef.current = type;
    if (switched && !reducedMotion() && typeof host.animate === 'function') {
      host.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) chart.resize(Math.floor(width), height);
    });
    observer.observe(host);

    const series = seriesRef.current;
    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      const drawn = param.point && param.time ? param.seriesData.get(series) : undefined;
      const real = type === 'heikin' && drawn ? realRef.current.get(Number(drawn.time)) : undefined;
      const item: HoveredItem | undefined = real
        ? { time: drawn?.time as Time, open: real.o, high: real.h, low: real.l, close: real.c }
        : (drawn as HoveredItem | undefined);
      const content = item && param.point ? tooltipContent(item, { format, intraday }) : null;
      setHover(
        content && param.point ? { ...content, x: param.point.x, width: host.clientWidth } : null,
      );
    };
    if (tooltip) chart.subscribeCrosshairMove(onCrosshairMove);
    onReadyRef.current?.({ chart, series, host });

    return () => {
      onReadyRef.current?.(null);
      if (tooltip) chart.unsubscribeCrosshairMove(onCrosshairMove);
      setHover(null);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [type, format, intraday, height, tooltip, interactive]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const drawn = drawnRef.current;
    drawnRef.current = { series, candles };
    // A live tick (T-108) changes or appends only the last bar: update it in place, so the chart
    // keeps its scroll and zoom and does not redraw every bar four times a second.
    const changes = drawn?.series === series ? trailingChanges(drawn.candles, candles) : null;
    if (type === 'heikin') {
      realRef.current = new Map(candles.map((candle) => [toChartTime(candle.t), candle]));
    }
    const points = seriesData(type, candles);
    // The library's setData and update take the series' own point type; the switch above made
    // `points` match this series, which TypeScript cannot follow through the union.
    const target = series as ISeriesApi<'Bar'> & ISeriesApi<'Line'>;
    if (changes) {
      // Heikin-Ashi bar i depends only on bars 0..i, so the changed tail is the HA tail too.
      for (const point of points.slice(points.length - changes.length)) {
        target.update(point as BarData & LineData);
      }
      return;
    }
    target.setData(points as (BarData & LineData)[]);
    chartRef.current?.timeScale().fitContent();
    // A new range or chart type fits its prices again, undoing a price-axis zoom (NSTOCK-0436).
    chartRef.current?.priceScale('right').setAutoScale(true);
  }, [candles, type, format, intraday, height, tooltip, interactive]);

  useEffect(() => {
    const series = seriesRef.current;
    if (series?.seriesType() === 'Area') series.applyOptions(areaSeriesOptions(direction, format));
    if (series?.seriesType() === 'Line') series.applyOptions(lineSeriesOptions(direction, format));
  }, [direction, format, type, intraday, height]);

  // `isolate` keeps the library's z-indexed canvases below an overlay drawn after the chart.
  return (
    <div
      className={cn('relative isolate w-full', interactive && 'overscroll-contain')}
      style={{ height }}
    >
      <div ref={hostRef} className="w-full" style={{ height }} data-testid="chart-host" />
      {hover ? <ChartTooltip {...hover} /> : null}
    </div>
  );
}

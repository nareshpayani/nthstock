import type { Candle } from '@nthstock/contracts';
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  LastPriceAnimationMode,
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
import { GLIDE_MS, closeOf, glidePoint } from '../model/tickGlide';
import { visibleTickLabels } from '../model/axisTags';
import { installDirectionLock } from '../model/directionLock';
import { formatChartValue, type ChartDirection, type ChartValueFormat } from '../model/chartFormat';
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
  // The tick labels last drawn and which of them show (NSTOCK-0446), to rebuild only on a change.
  const ticksRef = useRef<{ prices: readonly number[]; show: readonly boolean[] } | null>(null);
  const [hover, setHover] = useState<ChartTooltipState | null>(null);
  // The running tick glide (A16), so a new tick or a rebuild can stop it.
  const glideRef = useRef<number | null>(null);
  // Where that glide ends, so cancelling it mid-way still draws the bar's final close.
  const glideTargetRef = useRef<LineData<UTCTimestamp> | BarData<UTCTimestamp> | null>(null);
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
    // A16: the line's last point pulses once on each live tick, so the price reads as live.
    if (!isBarType(type) && !reducedMotion()) {
      seriesRef.current.applyOptions({ lastPriceAnimation: LastPriceAnimationMode.OnDataUpdate });
    }
    // NSTOCK-0446: a tick label the live price tag or a line's tag would half cover is left out.
    const tagged = seriesRef.current;
    chart.applyOptions({
      localization: {
        ...base.localization,
        tickmarksPriceFormatter: (prices: number[]) => {
          const show = visibleTickLabels(
            prices,
            (price) => tagged.priceToCoordinate(price),
            axisTagRows(tagged),
          );
          ticksRef.current = { prices, show };
          return prices.map((price: number, i: number) =>
            show[i] ? formatChartValue(price, format) : '',
          );
        },
      },
    });
    // A new chart type fades in over 160 ms (NSTOCK-0430); the overlay above it does not move.
    const switched = builtTypeRef.current !== null && builtTypeRef.current !== type;
    builtTypeRef.current = type;
    // A new chart draws its own tick labels; the old one's say nothing about them.
    ticksRef.current = null;
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
    // One direction per swipe (A13): up/down scrolls the page, sideways pans the chart.
    const unlockDirection = interactive ? installDirectionLock(host, chart) : undefined;
    onReadyRef.current?.({ chart, series, host });

    return () => {
      unlockDirection?.();
      if (glideRef.current !== null) cancelAnimationFrame(glideRef.current);
      glideRef.current = null;
      glideTargetRef.current = null;
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
    if (glideRef.current !== null) cancelAnimationFrame(glideRef.current);
    glideRef.current = null;
    // A glide cut short by this update must not leave its bar at a half-eased close.
    const cut = glideTargetRef.current;
    glideTargetRef.current = null;
    if (cut && drawn?.series === series) target.update(cut as BarData & LineData);
    if (changes) {
      // Heikin-Ashi bar i depends only on bars 0..i, so the changed tail is the HA tail too.
      const tail = points.slice(points.length - changes.length);
      const last = tail.at(-1);
      const before =
        drawn && type !== 'heikin' ? seriesData(type, drawn.candles.slice(-1)).at(-1) : undefined;
      // A16: a tick that moves the last bar in place glides there over 160 ms instead of jumping,
      // and the price rail's tabs ride along. A new bar, Heikin-Ashi and reduced motion jump.
      const glide =
        changes.length === 1 &&
        last !== undefined &&
        before !== undefined &&
        before.time === last.time &&
        type !== 'heikin' &&
        !reducedMotion();
      for (const point of glide ? tail.slice(0, -1) : tail) {
        target.update(point as BarData & LineData);
      }
      if (glide) {
        const from = closeOf(before);
        const started = performance.now();
        const step = (now: number) => {
          const progress = (now - started) / GLIDE_MS;
          target.update(glidePoint(last, from, progress) as BarData & LineData);
          if (progress < 1) {
            glideRef.current = requestAnimationFrame(step);
          } else {
            glideRef.current = null;
            glideTargetRef.current = null;
          }
        };
        glideTargetRef.current = last;
        glideRef.current = requestAnimationFrame(step);
      }
      // The live tag moved. Only when that changes which tick labels it covers, build them again
      // (applying price scale options tells the library its cached labels are stale): a rebuild on
      // every tick costs a long frame on a slow phone (T25). The chart's own localization is not
      // reapplied, since that also rebuilds the time axis labels under a held finger.
      const ticks = ticksRef.current;
      if (ticks) {
        const show = visibleTickLabels(
          ticks.prices,
          (price) => series.priceToCoordinate(price),
          axisTagRows(series),
        );
        if (show.some((shown, i) => shown !== ticks.show[i])) series.priceScale().applyOptions({});
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

/** Pixel rows of the tags on the price axis: the live price (when shown) and each line's label. */
function axisTagRows(series: AnySeries): number[] {
  const rows: number[] = [];
  const last = series.lastValueData(false);
  if (!last.noData && series.options().lastValueVisible) {
    const row = series.priceToCoordinate(last.price);
    if (row !== null) rows.push(row);
  }
  for (const line of series.priceLines()) {
    const { price, axisLabelVisible } = line.options();
    const row = axisLabelVisible ? series.priceToCoordinate(price) : null;
    if (row !== null) rows.push(row);
  }
  return rows;
}

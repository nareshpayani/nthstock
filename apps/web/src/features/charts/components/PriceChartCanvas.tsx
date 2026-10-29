import type { Candle } from '@nthstock/contracts';
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  HistogramSeries,
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toAreaData, toCandleData, toChartTime, toHeikinAshi } from '../model/chartData';
import { trailingChanges } from '../model/liveCandles';
import { GLIDE_MS, closeOf, glidePoint } from '../model/tickGlide';
import { visibleTickLabels } from '../model/axisTags';
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
import { legendContent } from '../model/chartLegend';
import { hasVolume, studyLines, type StudyId, type StudyLine } from '../model/studies';
import {
  VOLUME_HEIGHT,
  VOLUME_SCALE_ID,
  studyLineOptions,
  volumeBarColor,
  volumeSeriesOptions,
} from '../model/chartTheme';
import { ChartLegend } from './ChartLegend';
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
  /** Volume bars and indicator lines to draw (NSTOCK-0460). */
  studies?: readonly StudyId[] | undefined;
  /** The O, H, L, C legend over the top left that follows the crosshair (NSTOCK-0460). */
  legend?: boolean;
};

const NO_STUDIES: readonly StudyId[] = [];
/** The library's default price margins, put back when the volume bars go. */
const PRICE_MARGINS = { top: 0.2, bottom: 0.1 };
const PRICE_MARGINS_WITH_VOLUME = { top: 0.15, bottom: VOLUME_HEIGHT + 0.05 };

type StudySeries = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;

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
  studies = NO_STUDIES,
  legend = false,
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
  // The bar under the crosshair for the legend, by its chart time; null shows the last bar.
  const [legendTime, setLegendTime] = useState<number | null>(null);
  // The chart the study series below belong to, so a rebuilt chart gets new ones.
  const studyChartRef = useRef<IChartApi | null>(null);
  const studySeriesRef = useRef(new Map<string, StudySeries>());
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
    const owned = studySeriesRef.current;
    const onLegendMove = (param: MouseEventParams<Time>) => {
      setLegendTime(param.point && param.time !== undefined ? Number(param.time) : null);
    };
    if (legend) chart.subscribeCrosshairMove(onLegendMove);
    onReadyRef.current?.({ chart, series, host });

    return () => {
      if (glideRef.current !== null) cancelAnimationFrame(glideRef.current);
      glideRef.current = null;
      glideTargetRef.current = null;
      onReadyRef.current?.(null);
      if (tooltip) chart.unsubscribeCrosshairMove(onCrosshairMove);
      if (legend) chart.unsubscribeCrosshairMove(onLegendMove);
      setHover(null);
      setLegendTime(null);
      owned.clear();
      studyChartRef.current = null;
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [type, format, intraday, height, tooltip, interactive, legend]);

  // The indicator lines for the candles, shared by the chart and the legend.
  const studyKey = studies.join(',');
  const lines = useMemo<StudyLine[]>(
    () => studies.flatMap((study) => studyLines(study, candles)),
    // `studyKey` stands for `studies`, so a new array with the same studies does not recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candles, studyKey],
  );
  const showVolume = studies.includes('volume') && hasVolume(candles);

  // Volume bars and indicator lines (NSTOCK-0460): one series each, added or removed as the
  // studies change and given the candles' data on every update (a few hundred points each).
  useEffect(() => {
    const chart = chartRef.current;
    const main = seriesRef.current;
    if (!chart || !main) return;
    const owned = studySeriesRef.current;
    if (studyChartRef.current !== chart) {
      owned.clear();
      studyChartRef.current = chart;
    }
    const hadVolume = owned.has(VOLUME_SCALE_ID);
    const wanted = new Set(lines.map((line) => line.key));
    if (showVolume) wanted.add(VOLUME_SCALE_ID);
    for (const [key, series] of owned) {
      if (!wanted.has(key)) {
        chart.removeSeries(series);
        owned.delete(key);
      }
    }
    // Make room under the price for the bars, and give it back when they go.
    if (showVolume !== hadVolume) {
      main.priceScale().applyOptions({
        scaleMargins: showVolume ? PRICE_MARGINS_WITH_VOLUME : PRICE_MARGINS,
      });
    }
    const times = candles.map((candle) => toChartTime(candle.t));
    if (showVolume) {
      let volume = owned.get(VOLUME_SCALE_ID) as ISeriesApi<'Histogram'> | undefined;
      if (!volume) {
        volume = chart.addSeries(HistogramSeries, volumeSeriesOptions());
        chart.priceScale(VOLUME_SCALE_ID).applyOptions({
          scaleMargins: { top: 1 - VOLUME_HEIGHT, bottom: 0 },
          visible: false,
        });
        owned.set(VOLUME_SCALE_ID, volume);
      }
      volume.setData(
        candles.map((candle, i) => ({
          time: times[i] as UTCTimestamp,
          value: candle.v,
          color: volumeBarColor(candle.c >= candle.o),
        })),
      );
    }
    for (const line of lines) {
      let series = owned.get(line.key) as ISeriesApi<'Line'> | undefined;
      if (!series) {
        series = chart.addSeries(
          LineSeries,
          studyLineOptions(line.study as Exclude<StudyId, 'volume'>, format),
        );
        owned.set(line.key, series);
      }
      series.setData(
        line.values.flatMap((value, i) =>
          value === null ? [] : [{ time: times[i] as UTCTimestamp, value }],
        ),
      );
    }
    // The chart's own dependencies too: effects run in order, so a rebuilt chart (above) gets its
    // study series back in the same commit.
  }, [lines, showVolume, candles, type, format, intraday, height, tooltip, interactive, legend]);

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

  const legendIndex =
    legendTime === null
      ? candles.length - 1
      : candles.findIndex((candle) => toChartTime(candle.t) === legendTime);
  const legendView = legend
    ? legendContent(candles, legendIndex, lines, { format, volume: showVolume })
    : null;

  // `isolate` keeps the library's z-indexed canvases below an overlay drawn after the chart.
  return (
    <div
      className={cn('relative isolate w-full', interactive && 'overscroll-contain')}
      style={{ height }}
    >
      <div ref={hostRef} className="w-full" style={{ height }} data-testid="chart-host" />
      {legendView ? <ChartLegend {...legendView} /> : null}
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

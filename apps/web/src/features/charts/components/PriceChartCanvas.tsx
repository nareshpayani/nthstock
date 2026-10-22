import type { Candle } from '@nthstock/contracts';
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type LineData,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { cn } from '@nthstock/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toAreaData, toCandleData } from '../model/chartData';
import { trailingChanges } from '../model/liveCandles';
import type { ChartDirection, ChartValueFormat } from '../model/chartFormat';
import {
  TRADING_INTERACTION,
  areaSeriesOptions,
  candleSeriesOptions,
  chartOptions,
} from '../model/chartTheme';
import { tooltipContent, type HoveredItem } from '../model/chartTooltip';
import { ChartTooltip, type ChartTooltipState } from './ChartTooltip';

export type PriceChartCanvasProps = {
  candles: readonly Candle[];
  type: 'area' | 'candle';
  format: ChartValueFormat;
  direction: ChartDirection;
  intraday: boolean;
  height: number;
  /** Show the crosshair tooltip (IST time and ₹ values of the hovered bar). */
  tooltip?: boolean;
  /** Pan and pinch for a chart you trade from (SPEC-TFC-1 §10.5); the default chart is static. */
  interactive?: boolean;
  /**
   * The chart and its series once created, for an overlay that draws on it (T15); null when they
   * are removed. Called again whenever the chart is rebuilt (a new type, range or height).
   */
  onReady?: ((handle: ChartHandle | null) => void) | undefined;
};

type AnySeries = ISeriesApi<'Area'> | ISeriesApi<'Candlestick'>;

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
    seriesRef.current =
      type === 'candle'
        ? chart.addSeries(CandlestickSeries, candleSeriesOptions(format))
        : chart.addSeries(AreaSeries, areaSeriesOptions('flat', format));

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) chart.resize(Math.floor(width), height);
    });
    observer.observe(host);

    const series = seriesRef.current;
    const onCrosshairMove = (param: MouseEventParams<Time>) => {
      const item = param.point && param.time ? param.seriesData.get(series) : undefined;
      const content =
        item && param.point ? tooltipContent(item as HoveredItem, { format, intraday }) : null;
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
    if (changes) {
      for (const bar of changes) {
        if (series.seriesType() === 'Candlestick') {
          (series as ISeriesApi<'Candlestick'>).update(toCandleData([bar])[0] as CandlestickData);
        } else {
          (series as ISeriesApi<'Area'>).update(toAreaData([bar])[0] as LineData);
        }
      }
      return;
    }
    if (series.seriesType() === 'Candlestick') {
      (series as ISeriesApi<'Candlestick'>).setData(toCandleData(candles));
    } else {
      (series as ISeriesApi<'Area'>).setData(toAreaData(candles));
    }
    chartRef.current?.timeScale().fitContent();
  }, [candles, type, format, intraday, height, tooltip, interactive]);

  useEffect(() => {
    const series = seriesRef.current;
    if (series?.seriesType() === 'Area') series.applyOptions(areaSeriesOptions(direction, format));
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

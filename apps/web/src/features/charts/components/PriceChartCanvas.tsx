import type { Candle } from '@nthstock/contracts';
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { toAreaData, toCandleData } from '../model/chartData';
import type { ChartDirection, ChartValueFormat } from '../model/chartFormat';
import { areaSeriesOptions, candleSeriesOptions, chartOptions } from '../model/chartTheme';
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
};

type AnySeries = ISeriesApi<'Area'> | ISeriesApi<'Candlestick'>;

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
}: PriceChartCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<AnySeries | null>(null);
  const [hover, setHover] = useState<ChartTooltipState | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const chart = createChart(host, {
      ...chartOptions({ format, intraday }),
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

    return () => {
      if (tooltip) chart.unsubscribeCrosshairMove(onCrosshairMove);
      setHover(null);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [type, format, intraday, height, tooltip]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (series.seriesType() === 'Candlestick') {
      (series as ISeriesApi<'Candlestick'>).setData(toCandleData(candles));
    } else {
      (series as ISeriesApi<'Area'>).setData(toAreaData(candles));
    }
    chartRef.current?.timeScale().fitContent();
  }, [candles, type, format, intraday, height]);

  useEffect(() => {
    const series = seriesRef.current;
    if (series?.seriesType() === 'Area') series.applyOptions(areaSeriesOptions(direction, format));
  }, [direction, format, type, intraday, height]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={hostRef} className="w-full" style={{ height }} data-testid="chart-host" />
      {hover ? <ChartTooltip {...hover} /> : null}
    </div>
  );
}

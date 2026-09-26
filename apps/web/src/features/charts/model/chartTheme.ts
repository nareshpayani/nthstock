import { colors, fonts } from '@nthstock/tokens';
import { IST_TIME_ZONE } from '@nthstock/utils';
import {
  ColorType,
  CrosshairMode,
  TickMarkType,
  type AreaSeriesPartialOptions,
  type CandlestickSeriesPartialOptions,
  type ChartOptions,
  type DeepPartial,
  type Time,
} from 'lightweight-charts';

import { formatChartValue, type ChartDirection, type ChartValueFormat } from './chartFormat';

/**
 * `#RRGGBB` token → `rgba(r, g, b, alpha)`. The canvas cannot read CSS variables, so the chart
 * takes its colours from the same token object that generates them (packages/tokens).
 */
export function withAlpha(hex: string, alpha: number): string {
  const digits = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(digits)) throw new RangeError(`Expected a 6-digit colour: ${hex}`);
  const channel = (at: number) => Number.parseInt(digits.slice(at, at + 2), 16);
  return `rgba(${String(channel(0))}, ${String(channel(2))}, ${String(channel(4))}, ${String(alpha)})`;
}

const istFormatters = {
  year: new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, year: 'numeric' }),
  month: new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, month: 'short' }),
  day: new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    day: 'numeric',
    month: 'short',
  }),
  time: new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }),
  date: new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }),
  dateTime: new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }),
};

/** Chart times are UTC seconds (UTCTimestamp); every label is shown in IST. */
function toDate(time: Time): Date {
  return new Date(typeof time === 'number' ? time * 1000 : Number.NaN);
}

export function formatTickMark(time: Time, type: TickMarkType): string {
  const date = toDate(time);
  switch (type) {
    case TickMarkType.Year:
      return istFormatters.year.format(date);
    case TickMarkType.Month:
      return istFormatters.month.format(date);
    case TickMarkType.DayOfMonth:
      return istFormatters.day.format(date);
    default:
      return istFormatters.time.format(date);
  }
}

/** Crosshair label: date and time for intraday ranges, the date alone otherwise. */
export function formatCrosshairTime(time: Time, intraday: boolean): string {
  const date = toDate(time);
  return (intraday ? istFormatters.dateTime : istFormatters.date).format(date);
}

export type ChartThemeOptions = { format: ChartValueFormat; intraday: boolean };

/** Chart options from design tokens: surface background, line grid, ink-muted labels, IST times. */
export function chartOptions({ format, intraday }: ChartThemeOptions): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { type: ColorType.Solid, color: colors.surface },
      textColor: colors['ink-muted'],
      fontFamily: fonts.sans,
      fontSize: 12,
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { color: colors.line },
    },
    rightPriceScale: { borderColor: colors.line },
    timeScale: {
      borderColor: colors.line,
      timeVisible: intraday,
      secondsVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
      tickMarkFormatter: (time: Time, type: TickMarkType) => formatTickMark(time, type),
    },
    crosshair: {
      mode: CrosshairMode.Magnet,
      vertLine: { color: colors['ink-muted'], labelBackgroundColor: colors.ink },
      horzLine: { color: colors['ink-muted'], labelBackgroundColor: colors.ink },
    },
    localization: {
      locale: 'en-IN',
      priceFormatter: (value: number) => formatChartValue(value, format),
      timeFormatter: (time: Time) => formatCrosshairTime(time, intraday),
    },
    handleScroll: false,
    handleScale: false,
  };
}

const toneColor = (direction: ChartDirection) =>
  direction === 'up' ? colors.up : direction === 'down' ? colors.down : colors.brand;

/** Area series coloured by the move over the range: up green, down red, flat brand blue. */
export function areaSeriesOptions(
  direction: ChartDirection,
  format: ChartValueFormat,
): AreaSeriesPartialOptions {
  const line = toneColor(direction);
  return {
    lineColor: line,
    lineWidth: 2,
    topColor: withAlpha(line, 0.2),
    bottomColor: withAlpha(line, 0.02),
    priceLineVisible: false,
    crosshairMarkerBorderColor: colors.surface,
    crosshairMarkerBackgroundColor: line,
    priceFormat: {
      type: 'custom',
      minMove: 1,
      formatter: (value: number) => formatChartValue(value, format),
    },
  };
}

export function candleSeriesOptions(format: ChartValueFormat): CandlestickSeriesPartialOptions {
  return {
    upColor: colors.up,
    downColor: colors.down,
    borderUpColor: colors.up,
    borderDownColor: colors.down,
    wickUpColor: colors.up,
    wickDownColor: colors.down,
    priceLineVisible: false,
    priceFormat: {
      type: 'custom',
      minMove: 1,
      formatter: (value: number) => formatChartValue(value, format),
    },
  };
}

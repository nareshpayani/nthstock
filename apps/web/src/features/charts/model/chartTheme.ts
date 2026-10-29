import { colors, fonts } from '@nthstock/tokens';
import { IST_TIME_ZONE } from '@nthstock/utils';
import {
  ColorType,
  CrosshairMode,
  TickMarkType,
  type AreaSeriesPartialOptions,
  type HistogramSeriesPartialOptions,
  type LineStyle,
  type BarSeriesPartialOptions,
  type CandlestickSeriesPartialOptions,
  type LineSeriesPartialOptions,
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

/**
 * Gestures for a chart you trade from (SPEC-TFC-1 §10.5): horizontal touch drag pans and pinch
 * zooms, but vertical touch drag stays with the page so it still scrolls. Dragging the price axis
 * zooms prices (NSTOCK-0436); on a trading chart the gutter over the axis does that itself, since
 * a tap there starts an order. The axis is at least 64 px wide to hold a thumb.
 */
export const TRADING_INTERACTION = {
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: false,
  },
  handleScale: {
    mouseWheel: true,
    pinch: true,
    axisPressedMouseMove: { time: true, price: true },
    axisDoubleClickReset: false,
  },
  // Major tick marks on the price axis; the overlay draws the minor ones (SPEC-CR-1 §4.2).
  rightPriceScale: { minimumWidth: 64, ticksVisible: true },
} as const satisfies DeepPartial<ChartOptions>;

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

/** A plain close line, coloured like the area series (NSTOCK-0430). */
export function lineSeriesOptions(
  direction: ChartDirection,
  format: ChartValueFormat,
): LineSeriesPartialOptions {
  const line = toneColor(direction);
  return {
    color: line,
    lineWidth: 2,
    priceLineVisible: false,
    crosshairMarkerBorderColor: colors.surface,
    crosshairMarkerBackgroundColor: line,
    priceFormat: priceFormat(format),
  };
}

/** OHLC bars: open tick left, close tick right (NSTOCK-0430). */
export function barSeriesOptions(format: ChartValueFormat): BarSeriesPartialOptions {
  return {
    upColor: colors.up,
    downColor: colors.down,
    openVisible: true,
    thinBars: false,
    priceLineVisible: false,
    priceFormat: priceFormat(format),
  };
}

const priceFormat = (format: ChartValueFormat) =>
  ({
    type: 'custom',
    minMove: 1,
    formatter: (value: number) => formatChartValue(value, format),
  }) as const;

/**
 * Candles (and Heikin-Ashi): up bars solid green, down bars solid red (owner's call, NSTOCK-0436;
 * they were hollow up, filled down). Colour is not the only signal: a rising bar closes at its
 * top and the tooltip shows ▲ or ▼ with the change (WCAG 1.4.1). Heikin-Ashi hides the
 * last-value label: its close is smoothed, not a traded price.
 */
export function candleSeriesOptions(
  format: ChartValueFormat,
  { smoothed = false }: { smoothed?: boolean } = {},
): CandlestickSeriesPartialOptions {
  return {
    lastValueVisible: !smoothed,
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

/** The price scale the volume bars sit on: their own, in the bottom fifth of the plot. */
export const VOLUME_SCALE_ID = 'volume';
/** Room the price series leaves at the bottom for the volume bars, as a share of the height. */
export const VOLUME_HEIGHT = 0.2;

/** Volume bars (NSTOCK-0460): each bar green or red with its candle, light, behind the price. */
export const volumeBarColor = (up: boolean): string =>
  withAlpha(up ? colors.up : colors.down, 0.35);

export function volumeSeriesOptions(): HistogramSeriesPartialOptions {
  return {
    priceScaleId: VOLUME_SCALE_ID,
    priceFormat: { type: 'volume' },
    lastValueVisible: false,
    priceLineVisible: false,
  };
}

/**
 * Indicator lines (NSTOCK-0460) in the palette, not the library's defaults (A6): blue and ink,
 * told apart by solid or dashed as well as colour, so no line relies on colour alone. Marigold
 * stays the trailing stop's own colour; green and red stay price direction.
 */
// The library's LineStyle enum values, spelled out so this module needs only its types.
const SOLID = 0 as LineStyle;
const DOTTED = 1 as LineStyle;
const DASHED = 2 as LineStyle;

export const STUDY_LINE_STYLES = {
  sma20: { color: colors.brand, lineStyle: SOLID },
  sma50: { color: colors.brand, lineStyle: DASHED },
  ema20: { color: colors.ink, lineStyle: SOLID },
  vwap: { color: colors.ink, lineStyle: DASHED },
  bollinger: { color: colors['ink-muted'], lineStyle: DOTTED },
} as const;

export function studyLineOptions(
  study: keyof typeof STUDY_LINE_STYLES,
  format: ChartValueFormat,
): LineSeriesPartialOptions {
  return {
    ...STUDY_LINE_STYLES[study],
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: priceFormat(format),
  };
}

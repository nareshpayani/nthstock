import type { Candle } from '@nthstock/contracts';
import { toChartTime } from './chartData';

/**
 * Chart drawings (NSTOCK-0461): what the tool rail draws and how it measures. Points are a chart
 * time (UTC seconds) and a price (integer paise, or hundredths of an index point), so a drawing
 * stays on its prices and dates through a pan, a zoom or a new bar size.
 */
export type ChartPoint = { time: number; price: number };

export const DRAWING_TOOLS = [
  'trend',
  'horizontal',
  'ray',
  'fib',
  'text',
  'measure',
  'zoom',
] as const;
export type DrawingTool = (typeof DRAWING_TOOLS)[number];

/** Tools that need a second point; the rest are placed with one tap. */
export const TWO_POINT_TOOLS: readonly DrawingTool[] = ['trend', 'ray', 'fib', 'measure', 'zoom'];

/** Tools whose result is kept and saved; measure and zoom act once and leave nothing behind. */
export type Drawing =
  | { id: string; kind: 'trend' | 'ray' | 'fib'; from: ChartPoint; to: ChartPoint }
  | { id: string; kind: 'horizontal'; at: ChartPoint }
  | { id: string; kind: 'text'; at: ChartPoint; text: string };

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Each retracement level's price between a move's start and end (0 at the end, 1 at the start). */
export function fibPrices(from: ChartPoint, to: ChartPoint): { level: number; price: number }[] {
  return FIB_LEVELS.map((level) => ({
    level,
    price: Math.round(to.price - (to.price - from.price) * level),
  }));
}

export type Measure = {
  /** The price change, in paise or hundredths of a point. */
  change: number;
  /** The change in basis points of the starting price. */
  basisPoints: number;
  /** Bars between the two points, by their place in the candles. */
  bars: number;
  /** Time between them, in seconds. */
  seconds: number;
};

/** What the measure tool reads out between two points. */
export function measure(from: ChartPoint, to: ChartPoint, candles: readonly Candle[]): Measure {
  const change = to.price - from.price;
  return {
    change,
    basisPoints: from.price > 0 ? Math.round((change * 10_000) / from.price) : 0,
    bars: Math.abs(barIndex(candles, to.time) - barIndex(candles, from.time)),
    seconds: Math.abs(to.time - from.time),
  };
}

/** "3d 4h", "2h 15m", "45m": a span short enough for the measure label. */
export function formatSpan(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${String(days)}d ${String(hours)}h` : `${String(days)}d`;
  if (hours > 0) return rest > 0 ? `${String(hours)}h ${String(rest)}m` : `${String(hours)}h`;
  return `${String(rest)}m`;
}

/** The index of the last bar at or before `time` (0 before the first bar). */
export function barIndex(candles: readonly Candle[], time: number): number {
  let low = 0;
  let high = candles.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const at = toChartTime(candles[mid]?.t ?? '');
    if (at <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * The magnet (NSTOCK-0461): a point snaps to the nearest open, high, low or close of the bar under
 * it, so a line starts exactly on a swing high or low.
 */
export function snapToBar(point: ChartPoint, candles: readonly Candle[]): ChartPoint {
  const bar = candles[barIndex(candles, point.time)];
  if (!bar) return point;
  const nearest = [bar.o, bar.h, bar.l, bar.c].reduce((best, value) =>
    Math.abs(value - point.price) < Math.abs(best - point.price) ? value : best,
  );
  return { time: toChartTime(bar.t), price: nearest };
}

/**
 * Chart time → logical bar position, for x on the chart: whole bars by their index, a fraction
 * between two bars, and past either end at the series' typical bar spacing in time. Works for a
 * drawing made on another bar size, whose times fall between this one's bars.
 */
export function timeToLogical(candles: readonly Candle[], time: number): number {
  const count = candles.length;
  if (count === 0) return 0;
  const first = toChartTime(candles[0]?.t ?? '');
  const last = toChartTime(candles[count - 1]?.t ?? '');
  const step = count > 1 ? (last - first) / (count - 1) : 60;
  if (time <= first) return (time - first) / step;
  if (time >= last) return count - 1 + (time - last) / step;
  const index = barIndex(candles, time);
  const at = toChartTime(candles[index]?.t ?? '');
  const next = toChartTime(candles[index + 1]?.t ?? '');
  return next > at ? index + (time - at) / (next - at) : index;
}

/** The reverse of timeToLogical: a logical position on the chart back to a chart time. */
export function logicalToTime(candles: readonly Candle[], logical: number): number {
  const count = candles.length;
  if (count === 0) return 0;
  const first = toChartTime(candles[0]?.t ?? '');
  const last = toChartTime(candles[count - 1]?.t ?? '');
  const step = count > 1 ? (last - first) / (count - 1) : 60;
  if (logical <= 0) return Math.round(first + logical * step);
  if (logical >= count - 1) return Math.round(last + (logical - (count - 1)) * step);
  const index = Math.floor(logical);
  const at = toChartTime(candles[index]?.t ?? '');
  const next = toChartTime(candles[index + 1]?.t ?? '');
  return Math.round(at + (logical - index) * (next - at));
}

/**
 * How far one arrow press moves the keyboard point up or down (NSTOCK-0468): about a fiftieth of
 * the prices on screen, rounded to 1, 2 or 5 times a power of ten, and never under one 5-paise
 * tick (or 0.05 of an index point).
 */
export function priceStep(span: number): number {
  const raw = Math.abs(span) / 50;
  if (!Number.isFinite(raw) || raw <= 5) return 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 5, 10].find((step) => step * power >= raw) ?? 10;
  return nice * power;
}

/** The prices a drawing sits on, for its name in the drawings list. */
export function drawingPrices(drawing: Drawing): number[] {
  return drawing.kind === 'horizontal' || drawing.kind === 'text'
    ? [drawing.at.price]
    : [drawing.from.price, drawing.to.price];
}

/** Drawings in storage are user data: keep only well-formed ones. */
export function parseDrawings(raw: unknown): Drawing[] {
  if (!Array.isArray(raw)) return [];
  const isPoint = (value: unknown): value is ChartPoint =>
    typeof value === 'object' &&
    value !== null &&
    Number.isFinite((value as ChartPoint).time) &&
    Number.isFinite((value as ChartPoint).price);
  return raw.filter((item): item is Drawing => {
    if (typeof item !== 'object' || item === null) return false;
    const drawing = item as Record<string, unknown>;
    if (typeof drawing.id !== 'string') return false;
    switch (drawing.kind) {
      case 'trend':
      case 'ray':
      case 'fib':
        return isPoint(drawing.from) && isPoint(drawing.to);
      case 'horizontal':
        return isPoint(drawing.at);
      case 'text':
        return isPoint(drawing.at) && typeof drawing.text === 'string';
      default:
        return false;
    }
  });
}

/**
 * Escape that belongs to the control it was pressed in: a text field (the note box), a native
 * select, or an open menu. Those close themselves; the picked tool and the full-screen chart stay.
 */
export function keepsEscape(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return (
    target.matches('input, textarea, select, [aria-expanded="true"]') ||
    target.closest('[role="menu"], [role="listbox"]') !== null
  );
}

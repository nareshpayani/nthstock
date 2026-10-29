import type { Candle } from '@nthstock/contracts';

/**
 * Chart studies (NSTOCK-0460): volume bars and the indicators a trader expects on any chart.
 * Pure functions over the candles, values kept as integers (paise or hundredths of a point) like
 * every other chart value; null where a study has too few bars to say anything yet.
 */
export const STUDY_IDS = ['volume', 'sma20', 'sma50', 'ema20', 'vwap', 'bollinger'] as const;
export type StudyId = (typeof STUDY_IDS)[number];

/** Volume shows by default; the owner asked for it on every chart (2026-10-29). */
export const DEFAULT_STUDIES: readonly StudyId[] = ['volume'];

export const isStudyId = (value: unknown): value is StudyId =>
  typeof value === 'string' && (STUDY_IDS as readonly string[]).includes(value);

export const SMA_SHORT = 20;
export const SMA_LONG = 50;
export const EMA_PERIOD = 20;
export const BOLLINGER_PERIOD = 20;
export const BOLLINGER_WIDTH = 2;

/** Simple moving average of the last `period` values. */
export function sma(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  values.forEach((value, i) => {
    sum += value;
    if (i >= period) sum -= values[i - period] ?? 0;
    out.push(i >= period - 1 ? Math.round(sum / period) : null);
  });
  return out;
}

/** Exponential moving average, seeded with the simple average of the first `period` values. */
export function ema(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let previous: number | null = null;
  let seed = 0;
  values.forEach((value, i) => {
    if (previous === null) {
      seed += value;
      if (i === period - 1) previous = seed / period;
    } else {
      previous = value * k + previous * (1 - k);
    }
    out.push(previous === null ? null : Math.round(previous));
  });
  return out;
}

/** The IST calendar day of a bar, so VWAP starts again at each session's open. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istDay = (iso: string): number => Math.floor((Date.parse(iso) + IST_OFFSET_MS) / 86_400_000);

/**
 * Volume-weighted average price from each session's open: the sum of typical price (H + L + C) / 3
 * times volume over the sum of volume. Bars with no volume (an index) leave it null.
 */
export function vwap(candles: readonly Candle[]): (number | null)[] {
  let day: number | null = null;
  let priceVolume = 0;
  let volume = 0;
  return candles.map((candle) => {
    const today = istDay(candle.t);
    if (today !== day) {
      day = today;
      priceVolume = 0;
      volume = 0;
    }
    priceVolume += ((candle.h + candle.l + candle.c) / 3) * candle.v;
    volume += candle.v;
    return volume > 0 ? Math.round(priceVolume / volume) : null;
  });
}

export type Band = { upper: number; middle: number; lower: number };

/** Bollinger bands: the simple average ± `width` population standard deviations. */
export function bollinger(
  values: readonly number[],
  period = BOLLINGER_PERIOD,
  width = BOLLINGER_WIDTH,
): (Band | null)[] {
  const middle = sma(values, period);
  return values.map((_, i) => {
    const mean = middle[i];
    if (mean === null || mean === undefined) return null;
    let squares = 0;
    for (let j = i - period + 1; j <= i; j += 1) squares += ((values[j] ?? 0) - mean) ** 2;
    const spread = width * Math.sqrt(squares / period);
    return {
      upper: Math.round(mean + spread),
      middle: mean,
      lower: Math.round(mean - spread),
    };
  });
}

/** One line a study draws, by key, with a value (or a gap) per candle. */
export type StudyLine = { key: string; study: StudyId; values: (number | null)[] };

/** The lines an indicator draws over the price (volume is drawn as bars, not here). */
export function studyLines(study: StudyId, candles: readonly Candle[]): StudyLine[] {
  const closes = candles.map((candle) => candle.c);
  switch (study) {
    case 'sma20':
      return [{ key: study, study, values: sma(closes, SMA_SHORT) }];
    case 'sma50':
      return [{ key: study, study, values: sma(closes, SMA_LONG) }];
    case 'ema20':
      return [{ key: study, study, values: ema(closes, EMA_PERIOD) }];
    case 'vwap':
      return [{ key: study, study, values: vwap(candles) }];
    case 'bollinger': {
      const bands = bollinger(closes);
      return (['upper', 'middle', 'lower'] as const).map((part) => ({
        key: `bollinger-${part}`,
        study,
        values: bands.map((band) => band?.[part] ?? null),
      }));
    }
    default:
      return [];
  }
}

/** Whether the candles carry any volume at all (an index has none). */
export const hasVolume = (candles: readonly Candle[]): boolean => candles.some((c) => c.v > 0);

import type { Candle } from '@nthstock/contracts';

const MINUTE_MS = 60_000;

/**
 * One-minute OHLCV bars built from live ticks (SPEC-TFC-1 §6.7, PLAN-TFC-1 T07), so the 1D chart
 * shows the prices the paper engine traded on, the high and low of a replayed burst included.
 * One instance per instrument and session.
 */
export class MinuteBars {
  readonly #bars = new Map<number, Candle>();

  /** Folds one tick into the bar of its minute: `volume` is the shares traded on this tick. */
  record(at: number, price: number, volume = 0): void {
    const minute = Math.floor(at / MINUTE_MS) * MINUTE_MS;
    const bar = this.#bars.get(minute);
    if (!bar) {
      const t = new Date(minute).toISOString();
      this.#bars.set(minute, { t, o: price, h: price, l: price, c: price, v: volume });
      return;
    }
    bar.h = Math.max(bar.h, price);
    bar.l = Math.min(bar.l, price);
    bar.c = price;
    bar.v += volume;
  }

  get size(): number {
    return this.#bars.size;
  }

  /** The start of the first recorded minute, in epoch ms, or null when nothing is recorded. */
  firstMinute(): number | null {
    let first: number | null = null;
    for (const minute of this.#bars.keys()) if (first === null || minute < first) first = minute;
    return first;
  }

  /** Copies of the bars, oldest first. */
  bars(): Candle[] {
    return [...this.#bars.entries()].sort(([a], [b]) => a - b).map(([, bar]) => ({ ...bar }));
  }
}

/**
 * The 1D series: generated bars for the minutes before ticks were recorded, then the tick-built
 * bars. A generated bar for a minute that has a tick-built one is dropped, so every minute appears
 * once and the chart agrees with the prices the engine saw.
 */
export function mergeMinuteBars(generated: readonly Candle[], built: readonly Candle[]): Candle[] {
  if (built.length === 0) return [...generated];
  const first = Date.parse((built[0] as Candle).t);
  return [...generated.filter((bar) => Date.parse(bar.t) < first), ...built];
}

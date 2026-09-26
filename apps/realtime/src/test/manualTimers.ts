import type { Timers } from '../timers.js';

export type ManualTimers = Timers & {
  /** Current fake time in ms. */
  now(): number;
  /** Moves fake time forward, firing due intervals in order. */
  advance(ms: number): void;
  activeCount(): number;
};

/** Deterministic interval timers driven by `advance()`. */
export function manualTimers(start = 0): ManualTimers {
  let now = start;
  let nextId = 1;
  const intervals = new Map<number, { callback: () => void; ms: number; due: number }>();
  return {
    now: () => now,
    setInterval(callback, ms) {
      const id = nextId++;
      intervals.set(id, { callback, ms, due: now + ms });
      return id;
    },
    clearInterval(handle) {
      intervals.delete(handle as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next: { id: number; due: number } | null = null;
        for (const [id, timer] of intervals) {
          if (timer.due <= end && (!next || timer.due < next.due)) next = { id, due: timer.due };
        }
        if (!next) break;
        const timer = intervals.get(next.id);
        if (!timer) break;
        now = timer.due;
        timer.due += timer.ms;
        timer.callback();
      }
      now = end;
    },
    activeCount: () => intervals.size,
  };
}

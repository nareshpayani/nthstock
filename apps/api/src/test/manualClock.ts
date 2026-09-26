import type { Clock } from '@nthstock/utils';

export type ManualClock = Clock & {
  /** Moves time forward by `ms`. */
  advance(ms: number): void;
};

/** A clock that only moves when the test says so (no wall-clock time in tests). */
export function manualClock(
  start: string | number | Date = '2026-09-25T04:00:00.000Z',
): ManualClock {
  let at = new Date(start).getTime();
  return {
    now: () => new Date(at),
    advance: (ms) => {
      at += ms;
    },
  };
}

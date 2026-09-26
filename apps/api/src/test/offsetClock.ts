import type { Clock } from '@nthstock/utils';

export type OffsetClock = Clock & { advance(ms: number): void };

/**
 * The system clock plus an offset that only the test moves: for suites that run against a live
 * backend (the scenario suite) but need to jump past a throttle or an expiry.
 */
export function offsetClock(): OffsetClock {
  let offset = 0;
  return {
    now: () => new Date(Date.now() + offset),
    advance: (ms) => {
      offset += ms;
    },
  };
}

import { expect, it } from 'vitest';
import { inPool, perfMobile, tradingDayClock } from './smoke.js';

// The pure helpers of the perf smoke; the run itself is smoke.integration.test.ts.

it('runs work in a bounded pool, results in order', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await inPool(7, 3, async (index) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    return index * 2;
  });
  expect(results).toEqual([0, 2, 4, 6, 8, 10, 12]);
  expect(peak).toBe(3);
  expect(await inPool(0, 3, () => Promise.resolve(1))).toEqual([]);
});

it('keeps a trading-day clock on 28 Sep 2026 10:00 IST and moving forward', () => {
  const clock = tradingDayClock();
  const first = clock.now().getTime();
  expect(first).toBeGreaterThanOrEqual(Date.parse('2026-09-28T04:30:00.000Z'));
  expect(clock.now().getTime()).toBeGreaterThanOrEqual(first);
});

it('gives perf users valid mobiles clear of the demo and load-test ranges', () => {
  expect(perfMobile(0)).toBe('6100000000');
  expect(perfMobile(9_999)).toBe('6100009999');
  expect(perfMobile(9_999)).toMatch(/^[6-9]\d{9}$/);
});

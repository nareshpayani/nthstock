import { generateSymbolMaster } from '@nthstock/marketData';
import { WS_MAX_SUBSCRIPTIONS } from '@nthstock/contracts';
import { expect, test } from '@playwright/test';
import { PERF_TAG } from './support/env';
import { LONG_TASK_MS, mainThreadTasks, settle, traceWhile } from './support/perf';

// T-170: render performance with 200 ticking symbols for 10 s. No main-thread task in the Chrome
// trace may exceed 50 ms (Chrome's long-task threshold). Runs in the "Web vitals and render
// budgets" CI job (npm run e2e:perf); the trace is attached to the report and opens in Chrome
// DevTools' Performance panel or ui.perfetto.dev.
//
// The product caps a watchlist at 50 stocks and mounts only the rows in view (T-119), so the real
// panel never has 200 live cells. The stress page (/dev/prices?symbols=…) mounts 200 watchlist-style
// rows at once, each with the same <PriceCell> and quote store as the watchlist, subscribed over the
// same WebSocket path: the most a connection may subscribe to (WS_MAX_SUBSCRIPTIONS), a heavier
// load than any real screen.

const MEASURE_MS = 10_000;

/** The 200 largest NSE equities of the mock symbol master, the one the app runs on. */
const SYMBOLS = generateSymbolMaster()
  .equities.filter((equity) => equity.instrument.exchange === 'NSE')
  .sort((a, b) => a.rank - b.rank)
  .slice(0, WS_MAX_SUBSCRIPTIONS)
  .map((equity) => equity.instrument.symbol);

test(`200 ticking symbols for 10 s: no main-thread task over 50 ms ${PERF_TAG}`, async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  expect(SYMBOLS).toHaveLength(200);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/dev/prices?symbols=${SYMBOLS.map(encodeURIComponent).join(',')}`);
  const rows = page.getByRole('list', { name: 'Stress watchlist' }).getByRole('listitem');
  await expect(rows).toHaveCount(200);
  // Every row has a live price before measuring starts.
  await expect
    .poll(
      () =>
        rows.evaluateAll(
          (items) => items.filter((item) => /₹[\d,]+\.\d{2}/.test(item.textContent ?? '')).length,
        ),
      { timeout: 20_000 },
    )
    .toBe(200);
  await settle(page, 1_000);

  // Count price changes in the window, to prove the symbols tick while the trace runs.
  await page.evaluate(() => {
    const list = document.querySelector('[aria-label="Stress watchlist"]');
    const state = { changes: 0 };
    new MutationObserver((records) => {
      state.changes += records.length;
    }).observe(list ?? document.body, { subtree: true, characterData: true, childList: true });
    (window as unknown as { stress: typeof state }).stress = state;
  });

  const trace = await traceWhile(browser, page, () => page.waitForTimeout(MEASURE_MS));
  const changes = await page.evaluate(
    () => (window as unknown as { stress: { changes: number } }).stress.changes,
  );
  const tasks = mainThreadTasks(trace);
  const longest = tasks[0]?.durationMs ?? 0;
  const over = tasks.filter((task) => task.durationMs > LONG_TASK_MS);
  await testInfo.attach('trace.json', { body: trace, contentType: 'application/json' });
  await testInfo.attach('longest-main-thread-tasks', {
    body: JSON.stringify({ changes, longest: tasks.slice(0, 10) }, null, 2),
    contentType: 'application/json',
  });
  console.info(
    `200 symbols, ${String(MEASURE_MS / 1000)} s: ${String(changes)} DOM updates, ${String(tasks.length)} main-thread tasks, longest ${longest.toFixed(1)} ms`,
  );

  // The mock market ticks every symbol about once a second, so 200 symbols give well over a
  // thousand updates in 10 s.
  expect(changes).toBeGreaterThan(1_000);
  expect(tasks.length).toBeGreaterThan(0);
  expect(over, `main-thread tasks over ${String(LONG_TASK_MS)} ms`).toEqual([]);
});

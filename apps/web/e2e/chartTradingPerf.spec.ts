import { expect, test, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { PERF_TAG } from './support/env';
import { settle } from './support/perf';

// T25 (SPEC-TFC-1 §12, REQ-MOB-03): the chart-trading page on a 390 × 844 phone while the focused
// instrument ticks four times a second, a handle is dragged and the page scrolls. Two runs:
//
// - Frame time, unthrottled: p95 of requestAnimationFrame deltas within one 16.7 ms frame (60 fps).
//   The deltas come in whole vsync intervals with a little clock jitter (16.6 to 16.8 ms for one
//   frame, 33.3 for a dropped one), so "within one frame" is checked as under one and a half.
// - Main-thread blocking, at 4× CPU throttling: no long animation frame over 50 ms
//   (the Long Animation Frames API).
//
// Runs in the "Web vitals and render budgets" CI job (npm run e2e:perf). Each run attaches its
// numbers, which the design rationale (WRITEUP.md) quotes.

const FRAME_MS = 1000 / 60;
/** Half way to the next vsync: a delta under this was one frame, not a dropped one. */
const ONE_FRAME_MS = FRAME_MS * 1.5;
const LOAF_BUDGET_MS = 50;
const SCENARIO_MS = 6_000;

type Sample = { frames: number[]; loafs: number[]; priceUpdates: number; seconds: number };

async function openChart(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  const figure = page.getByRole('figure', { name: /INFY area chart/ });
  const gutter = figure.getByTestId('chart-gutter');
  await expect(gutter).toBeVisible();
  await figure.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  // A ghost order line to drag: a tap on the price gutter, a third of the way down.
  const lane = await gutter.boundingBox();
  if (!lane) throw new Error('no gutter');
  await page.mouse.click(lane.x + lane.width / 2, lane.y + lane.height / 3);
  const ghost = figure.locator('[data-testid="chart-handle"][data-tone="ghost"]');
  await expect(ghost).toBeVisible();
  await settle(page, 1_000);
  return { figure, ghost };
}

/** Starts recording frame deltas, long animation frames and price text updates. */
async function startRecording(page: Page) {
  await page.evaluate(() => {
    const sample = { frames: [] as number[], loafs: [] as number[], priceUpdates: 0, start: 0 };
    let last: number | null = null;
    let running = true;
    const frame = (at: number) => {
      if (last !== null) sample.frames.push(at - last);
      last = at;
      if (running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    if (!PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
      throw new Error('this browser has no Long Animation Frames API');
    }
    const loaf = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) sample.loafs.push(entry.duration);
    });
    loaf.observe({ type: 'long-animation-frame' });
    const prices = new MutationObserver((records) => {
      for (const record of records) {
        if (/₹/.test(record.target.textContent ?? '')) sample.priceUpdates += 1;
      }
    });
    prices.observe(document.querySelector('main') ?? document.body, {
      subtree: true,
      characterData: true,
      childList: true,
    });
    sample.start = performance.now();
    (window as unknown as { perfSample: unknown }).perfSample = {
      sample,
      stop: () => {
        running = false;
        loaf.disconnect();
        prices.disconnect();
        return {
          frames: sample.frames,
          loafs: sample.loafs,
          priceUpdates: sample.priceUpdates,
          seconds: (performance.now() - sample.start) / 1000,
        };
      },
    };
  });
}

const stopRecording = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { perfSample: { stop: () => Sample } }).perfSample.stop(),
  );

/** The scenario: drag the ghost handle up and down for 3 s, then scroll the page for 3 s. */
async function runScenario(page: Page, ghost: ReturnType<Page['locator']>) {
  const box = await ghost.boundingBox();
  if (!box) throw new Error('no ghost handle');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 90;
  for (let i = 1; i <= steps; i += 1) {
    const offset = Math.sin((i / steps) * Math.PI * 4) * 60;
    await page.mouse.move(x, y + offset);
    await page.waitForTimeout(SCENARIO_MS / 2 / steps);
  }
  await page.mouse.up();
  // Scroll below the chart, where the wheel scrolls the page rather than zooming the plot.
  await page.mouse.move(195, 800);
  for (let i = 0; i < 30; i += 1) {
    await page.mouse.wheel(0, i < 15 ? 40 : -40);
    await page.waitForTimeout(SCENARIO_MS / 2 / 30);
  }
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0;
};

test.describe(`chart trading at 390 px under ticks, drag and scroll (T25) ${PERF_TAG}`, () => {
  test.setTimeout(120_000);

  test('frame time p95 within one 60 fps frame', async ({ page }, testInfo) => {
    const { ghost } = await openChart(page);
    await startRecording(page);
    await runScenario(page, ghost);
    const sample = await stopRecording(page);
    const p95 = percentile(sample.frames, 95);
    const ticksPerSecond = sample.priceUpdates / sample.seconds;
    const report = {
      frames: sample.frames.length,
      p50Ms: percentile(sample.frames, 50),
      p95Ms: p95,
      p99Ms: percentile(sample.frames, 99),
      worstMs: Math.max(...sample.frames),
      droppedFrames: sample.frames.filter((delta) => delta >= ONE_FRAME_MS).length,
      priceUpdatesPerSecond: ticksPerSecond,
    };
    await testInfo.attach('frame-time', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    console.info(
      `Chart trading, 390 px, ${sample.seconds.toFixed(1)} s: ${String(report.frames)} frames, p50 ${report.p50Ms.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, p99 ${report.p99Ms.toFixed(1)} ms, ${ticksPerSecond.toFixed(1)} price updates a second`,
    );
    // The prices moved while it measured: the focused instrument ticks four times a second.
    expect(ticksPerSecond).toBeGreaterThan(2);
    expect(p95, 'p95 frame time, ms: one frame').toBeLessThan(ONE_FRAME_MS);
  });

  test('no long animation frame over 50 ms at 4× CPU throttling', async ({ page }, testInfo) => {
    const { ghost } = await openChart(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await startRecording(page);
    await runScenario(page, ghost);
    const sample = await stopRecording(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const longest = sample.loafs.length === 0 ? 0 : Math.max(...sample.loafs);
    await testInfo.attach('long-animation-frames', {
      body: JSON.stringify(
        { count: sample.loafs.length, longestMs: longest, all: sample.loafs },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    console.info(
      `Chart trading, 390 px, 4× CPU: ${String(sample.loafs.length)} long animation frames, longest ${longest.toFixed(1)} ms`,
    );
    expect(longest, 'longest animation frame, ms').toBeLessThanOrEqual(LOAF_BUDGET_MS);
  });
});

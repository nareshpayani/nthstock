import { expect, test, type Browser, type Page } from '@playwright/test';

// T-100 and T-101: the dashboard on MSW data. The e2e build forces the mock market open
// (playwright.config.ts), so prices tick once a second. The screenshot test holds the page clock
// so no tick happens; the CLS test loads the page at real speed, ticks included.

/** Friday 25 Sep 2026, 10:30 IST: a trading day inside NSE hours ("Good morning", LIVE badge). */
const FROZEN_TIME = new Date('2026-09-25T05:00:00.000Z');
const DESKTOP = { width: 1440, height: 900 };
/** The mock market ticks every 1,000 ms of page time; the frozen load stays well below that. */
const FAKE_TIME_BUDGET_MS = 900;
/** Page time advanced per step while loading (a few animation frames). */
const FAKE_TIME_STEP_MS = 20;
/** Share of pixels allowed to differ between two frozen loads (anti-aliasing noise only). */
const MAX_DIFF_RATIO = 0.001;

/** True once every dashboard section and both header tickers show data and fonts are in. */
function dashboardReady(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const main = document.querySelector('main');
      const banner = document.querySelector('header');
      if (!main || !banner || document.fonts.status !== 'loaded') return false;
      const section = (title: string) =>
        [...main.querySelectorAll('section')].find(
          (element) => element.querySelector('h2')?.textContent === title,
        );
      const stockLinks = (title: string) =>
        section(title)?.querySelectorAll('a[href^="/stocks/"]').length ?? 0;
      // Lightweight Charts paints on animation frames: some chart canvas has more than one colour.
      const chartPainted = [...main.querySelectorAll('figure canvas')].some((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0) return false;
        const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height);
        if (!pixels) return false;
        const { data } = pixels;
        for (let i = 4; i < data.length; i += 4 * 7) {
          if (
            data[i] !== data[0] ||
            data[i + 1] !== data[1] ||
            data[i + 2] !== data[2] ||
            data[i + 3] !== data[3]
          ) {
            return true;
          }
        }
        return false;
      });
      return (
        main.querySelector('h1') !== null &&
        chartPainted &&
        main.querySelectorAll('[role="status"][aria-label^="Loading"]').length === 0 &&
        main.querySelectorAll('[aria-busy="true"]').length === 0 &&
        banner.querySelectorAll('[aria-busy="true"]').length === 0 &&
        stockLinks('Stocks lists') === 5 &&
        stockLinks('Market movers') > 0
      );
    })
    .catch(() => false); // the page is still navigating
}

/**
 * Loads the dashboard with the page clock paused at FROZEN_TIME and advanced by hand, 20 ms at
 * a time, only while the page needs timers to finish loading. Network and rendering run at real
 * speed, so a slow runner only takes longer; it never lets a tick in. The result is the same data
 * and the same pixels on every run.
 */
async function loadFrozenDashboard(page: Page) {
  // Installed a minute early so pausing at FROZEN_TIME is always a jump forward, however long
  // the install took (the blank page has no timers to fire on the way).
  await page.clock.install({ time: new Date(FROZEN_TIME.getTime() - 60_000) });
  await page.clock.pauseAt(FROZEN_TIME);
  await page.setViewportSize(DESKTOP);
  await page.goto('/dashboard', { waitUntil: 'commit' });
  let fakeElapsed = 0;
  await expect
    .poll(
      async () => {
        if (await dashboardReady(page)) return true;
        if (fakeElapsed < FAKE_TIME_BUDGET_MS) {
          await page.clock.runFor(FAKE_TIME_STEP_MS);
          fakeElapsed += FAKE_TIME_STEP_MS;
        }
        return false;
      },
      { timeout: 45_000, intervals: [20] },
    )
    .toBe(true);
  // No price has ticked: every live value still shows its first quote.
  await expect(page.locator('[data-tick="up"], [data-tick="down"]')).toHaveCount(0);
}

const shot = (page: Page, path?: string) =>
  page.screenshot({
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    ...(path ? { path } : {}),
  });

/** Share of differing pixels between two PNGs, decoded in a blank page (no extra dependencies). */
async function pixelDiffRatio(browser: Browser, a: Buffer, b: Buffer): Promise<number> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([first, second]) => {
        const decode = async (base64: string) => {
          const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
          const bitmap = await createImageBitmap(blob);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no 2d context');
          context.drawImage(bitmap, 0, 0);
          return context.getImageData(0, 0, bitmap.width, bitmap.height);
        };
        const [x, y] = await Promise.all([decode(first), decode(second)]);
        if (x.width !== y.width || x.height !== y.height) return 1;
        let differing = 0;
        for (let i = 0; i < x.data.length; i += 4) {
          if (
            x.data[i] !== y.data[i] ||
            x.data[i + 1] !== y.data[i + 1] ||
            x.data[i + 2] !== y.data[i + 2]
          ) {
            differing += 1;
          }
        }
        return differing / (x.width * x.height);
      },
      [a.toString('base64'), b.toString('base64')] as const,
    );
  } finally {
    await page.close();
  }
}

test('dashboard screenshot at 1440 px (T-100)', async ({ page, browser }, testInfo) => {
  // Two full page loads; a busy CI runner needs more than the default 30 s.
  test.setTimeout(120_000);
  await loadFrozenDashboard(page);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Good morning' })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('status').first()).toHaveAccessibleName(
    /Market open/,
  );

  // Reference layout at desktop width: the rail on the left, then hero, chart, indices, and the
  // lists beside the movers.
  const box = async (name: string | RegExp) => {
    const rect = await main.getByRole('region', { name }).boundingBox();
    if (!rect) throw new Error(`${String(name)} is not laid out`);
    return rect;
  };
  const rail = await page
    .getByRole('complementary', { name: 'Watchlist and search' })
    .boundingBox();
  const hero = await box('Good morning');
  const chart = await box(/^NIFTY 50/);
  const indices = await box('Market indices');
  const lists = await box('Stocks lists');
  const movers = await box('Market movers');
  expect(rail?.width).toBe(320);
  expect(hero.y).toBeLessThan(chart.y);
  expect(chart.y).toBeLessThan(indices.y);
  expect(indices.y).toBeLessThan(lists.y);
  expect(Math.abs(lists.y - movers.y)).toBeLessThanOrEqual(1);
  expect(lists.x).toBeLessThan(movers.x);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // In the HTML report, and at a fixed file name that CI uploads as the `dashboard-screenshot`
  // artifact for the PR.
  const screenshot = await shot(page, testInfo.outputPath('dashboard-1440.png'));
  await testInfo.attach('dashboard-1440', { body: screenshot, contentType: 'image/png' });

  // Deterministic: a second, independent load in a fresh browser context gives the same pixels,
  // on whatever machine runs this, so no baseline from another platform is needed.
  const context = await browser.newContext({ viewport: DESKTOP });
  try {
    const second = await context.newPage();
    await loadFrozenDashboard(second);
    const again = await shot(second);
    const ratio = await pixelDiffRatio(browser, screenshot, again);
    if (ratio > 0) {
      await testInfo.attach('dashboard-1440-second-load', {
        body: again,
        contentType: 'image/png',
      });
    }
    expect(ratio).toBeLessThanOrEqual(MAX_DIFF_RATIO);
  } finally {
    await context.close();
  }
});

type ShiftReport = { cls: number; shifts: { value: number; sources: string[] }[] };

/**
 * Records layout shifts from navigation on and computes CLS as web-vitals does: the largest
 * session window (shifts under 1 s apart, at most 5 s long), ignoring shifts right after input.
 */
async function observeLayoutShifts(page: Page) {
  await page.addInitScript(() => {
    type Shift = PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
      sources?: { node?: Node | null }[];
    };
    const report: ShiftReport = { cls: 0, shifts: [] };
    let windowValue = 0;
    let windowStart = 0;
    let previous = 0;
    const name = (node: Node | null | undefined) =>
      node instanceof Element
        ? `${node.tagName.toLowerCase()} "${(node.textContent ?? '').slice(0, 40)}"`
        : (node?.nodeName ?? 'unknown');
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Shift[]) {
        if (entry.hadRecentInput) continue;
        const sameWindow =
          windowValue > 0 &&
          entry.startTime - previous < 1_000 &&
          entry.startTime - windowStart < 5_000;
        if (sameWindow) windowValue += entry.value;
        else {
          windowValue = entry.value;
          windowStart = entry.startTime;
        }
        previous = entry.startTime;
        report.cls = Math.max(report.cls, windowValue);
        report.shifts.push({
          value: entry.value,
          sources: (entry.sources ?? []).map((source) => name(source.node)),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
    (window as unknown as { layoutShifts: ShiftReport }).layoutShifts = report;
  });
}

for (const viewport of [DESKTOP, { width: 390, height: 844 }]) {
  test(`dashboard CLS during load is under 0.05 at ${String(viewport.width)} px (T-101)`, async ({
    page,
  }, testInfo) => {
    // Only the date is fixed (the same greeting and data every run); timers run at real speed,
    // so skeletons, the lazy chart, fonts and live ticks all happen as they do for a user.
    await page.clock.setFixedTime(FROZEN_TIME);
    await page.setViewportSize(viewport);
    await observeLayoutShifts(page);
    await page.goto('/dashboard');
    await expect.poll(() => dashboardReady(page), { timeout: 30_000 }).toBe(true);
    // Let any late shift (a font, the chart's first paint) land before reading the result.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 500))),
    );
    const report = await page.evaluate(
      () => (window as unknown as { layoutShifts: ShiftReport }).layoutShifts,
    );
    await testInfo.attach('layout-shifts', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    expect(report.cls, JSON.stringify(report.shifts, null, 2)).toBeLessThan(0.05);
  });
}

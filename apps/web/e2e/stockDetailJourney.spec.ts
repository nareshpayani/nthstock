import { expect, test, type Page } from '@playwright/test';

// T-114: search → stock detail → every chart range → market depth, on MSW data. The e2e build
// forces the mock market open (playwright.config.ts), so depth refreshes every second.
// T-112: responsive layout checks and screenshots at 1440 and 768 px.

const RANGES = [
  ['1W', '1 week'],
  ['1M', '1 month'],
  ['1Y', '1 year'],
  ['5Y', '5 years'],
  ['1D', '1 day'],
] as const;

const depthCard = (page: Page) => page.getByRole('region', { name: 'Market depth' });

/** Waits until both depth tables show five priced levels. */
async function expectDepth(page: Page) {
  const card = depthCard(page);
  for (const name of ['Bids (buy orders)', 'Offers (sell orders)']) {
    const table = card.getByRole('table', { name });
    await expect(table.locator('tbody tr')).toHaveCount(5);
    await expect(table.locator('tbody tr').first()).toContainText(/₹[\d,]+\.\d{2}/);
    await expect(table.getByTestId('depth-bar')).toHaveCount(5);
  }
}

test('search, open stock detail, switch all five ranges, see depth (T-114)', async ({ page }) => {
  // Five chart loads plus search; a busy CI runner needs more than the default 30 s.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  await page.getByRole('heading', { level: 1 }).waitFor();

  const search = page.getByRole('complementary').getByRole('combobox', { name: 'Search stocks' });
  await search.click();
  await search.fill('infy');
  const option = page
    .getByRole('complementary')
    .getByRole('listbox', { name: 'Stock suggestions' })
    .getByRole('option')
    .first();
  await expect(option).toContainText('INFY');
  await option.click();

  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();
  await expect(
    page.getByRole('figure', { name: 'INFY area chart over 1 day' }).locator('canvas').first(),
  ).toBeVisible();

  for (const [range, spelled] of RANGES) {
    await page.getByRole('radio', { name: range, exact: true }).click();
    await expect(page.getByRole('radio', { name: range, exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const chart = page.getByRole('figure', { name: `INFY area chart over ${spelled}` });
    await expect(chart.locator('canvas').first()).toBeVisible();
  }

  await expectDepth(page);
  await expect(depthCard(page).getByText('Top 5 levels, updated every second')).toBeVisible();
  await expect(depthCard(page).getByRole('rowheader', { name: 'Total bid qty' })).toBeVisible();

  // The overview sits under the key stats with its Read more toggle.
  const overview = page.getByRole('region', { name: 'Overview' });
  await overview.getByRole('button', { name: 'Read more' }).click();
  await expect(overview.getByRole('button', { name: 'Read less' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

test('depth refreshes without shifting the layout, and pauses in a hidden tab', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/stocks/INFY');
  await expectDepth(page);
  // Content above the card (the lazy chart) settles after the first depth paint and shifts the
  // card with it; only shifts from the depth refreshes themselves are under test.
  await expect(
    page.getByRole('figure', { name: 'INFY area chart over 1 day' }).locator('canvas').first(),
  ).toBeVisible();

  const depthRequests: number[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/depth')) depthRequests.push(Date.now());
  });
  // Record layout shifts caused by anything inside the depth card from here on.
  await depthCard(page).evaluate((card) => {
    const shifts: number[] = [];
    (window as unknown as { depthShifts: number[] }).depthShifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        sources?: { node?: Node | null }[];
      }[]) {
        if (entry.sources?.some((source) => source.node && card.contains(source.node))) {
          shifts.push(entry.value);
        }
      }
    }).observe({ type: 'layout-shift' });
  });
  const box = await depthCard(page).boundingBox();

  await expect.poll(() => depthRequests.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const shifts = await page.evaluate(
    () => (window as unknown as { depthShifts: number[] }).depthShifts,
  );
  expect(shifts).toEqual([]);
  expect(await depthCard(page).boundingBox()).toEqual(box);

  // Hide the tab: polling stops.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(
    depthCard(page).getByText('Top 5 levels, updates paused while hidden'),
  ).toBeVisible();
  const paused = depthRequests.length;
  await page.waitForTimeout(2_500);
  expect(depthRequests.length).toBe(paused);
});

for (const width of [1440, 768]) {
  test(`stock detail layout and screenshot at ${String(width)} px (T-112)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/stocks/INFY');
    await expectDepth(page);
    await expect(page.getByRole('region', { name: 'Overview' }).getByRole('heading')).toHaveCount(
      2,
    );

    const chart = await page.getByRole('region', { name: 'Price chart' }).boundingBox();
    const depth = await depthCard(page).boundingBox();
    const stats = await page.getByRole('region', { name: 'Key stats' }).boundingBox();
    if (!chart || !depth || !stats) throw new Error('a section has no box');
    if (width >= 1024) {
      // Depth to the right of the chart, top-aligned; stats under the chart.
      expect(depth.x).toBeGreaterThanOrEqual(chart.x + chart.width);
      expect(Math.abs(depth.y - chart.y)).toBeLessThan(2);
      expect(stats.y).toBeGreaterThan(chart.y + chart.height);
      expect(Math.abs(stats.x - chart.x)).toBeLessThan(2);
    } else {
      // Stacked: chart, then depth, then stats, all full width.
      expect(depth.y).toBeGreaterThan(chart.y + chart.height);
      expect(stats.y).toBeGreaterThan(depth.y + depth.height);
      expect(Math.abs(depth.width - chart.width)).toBeLessThan(2);
    }

    const screenshot = await page.screenshot({
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      path: testInfo.outputPath(`stock-detail-${String(width)}.png`),
    });
    await testInfo.attach(`stock-detail-${String(width)}`, {
      body: screenshot,
      contentType: 'image/png',
    });
  });
}

test('no horizontal scroll on stock detail at 360 px (T-112)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/stocks/INFY');
  await expectDepth(page);
  await expect(page.getByRole('region', { name: 'Overview' }).getByRole('heading')).toHaveCount(2);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

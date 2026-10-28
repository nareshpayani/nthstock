import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { TOUCH_TAG } from './support/env';
import { centreOf, touchscreen, type Touch } from './support/touch';

// T20 (SPEC-TFC-1 §9.1, REQ-MOB-01, REQ-MOB-02): every row of the gesture table, by touch, on the
// touch projects. On Chromium the gestures are real touches (two fingers for a pinch); WebKit gets
// a single-finger touchscreen from Playwright, so the rows that need two fingers or a real touch
// scroll say so and run on Chromium.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so NSE is open for the paper engine.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');
const NEEDS_REAL_TOUCH = 'Playwright drives WebKit with a one-finger touchscreen only';
const NEEDS_PINCH =
  'Panning needs a zoom first, and mobile WebKit in Playwright has neither a pinch nor a wheel';

type Chart = {
  page: Page;
  touch: Touch;
  figure: Locator;
  host: Locator;
  gutter: Locator;
  /** A picture of the dates along the bottom: it changes only when time pans or zooms. */
  timeAxis: () => Promise<Buffer>;
  /** Waits until the time axis stops moving (after a zoom, or the chart's first fit). */
  settle: () => Promise<void>;
};

async function openChart(page: Page): Promise<Chart> {
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  const figure = page.getByRole('figure', { name: /INFY area chart/ });
  const gutter = figure.getByTestId('chart-gutter');
  await expect(gutter).toBeVisible();
  const host = figure.getByTestId('chart-host');
  await host.scrollIntoViewIfNeeded();
  const timeAxis = async () => {
    // The same place on screen each time, clear of the sticky bottom bar on a short phone (the
    // iPhone 13 is 664 px tall): a tap target scrolled to the centre moves the page.
    await host.evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'nearest' }),
    );
    const plot = await host.boundingBox();
    if (!plot) throw new Error('no chart');
    const clip = { x: plot.x, y: plot.y + plot.height - 26, width: plot.width - 72, height: 26 };
    return page.screenshot({ clip });
  };
  const settle = () =>
    expect
      .poll(async () => {
        const a = await timeAxis();
        await page.waitForTimeout(300);
        return a.equals(await timeAxis());
      })
      .toBe(true);
  return { page, touch: await touchscreen(page), figure, host, gutter, timeAxis, settle };
}

/** Zooms in on the plot with a pinch, so there is time to pan to. */
async function zoomIn({ touch, host, settle }: Chart) {
  await touch.pinch(await centreOf(host), 40, 240);
  await settle();
}

const rupees = (text: string) => {
  const match = /₹([\d,]+\.\d\d)/.exec(text);
  if (!match?.[1]) throw new Error(`no price in "${text}"`);
  return Number(match[1].replaceAll(',', ''));
};

/** Records every order the page sends: places, modifies and cancels. */
function orderRequests(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/v1\/orders/.test(request.url())) {
      sent.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  return sent;
}

/** A buy limit half a percent under the market, placed with taps from the ticket. */
async function placeBuyLimit({ page, touch, figure }: Chart): Promise<Locator> {
  const bar = page.getByRole('group', { name: 'Trade INFY' });
  await touch.tap(await centreOf(bar.getByRole('button', { name: 'Buy INFY' })));
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await touch.tap(
    await centreOf(
      ticket.getByRole('radiogroup', { name: 'Order type' }).getByRole('radio', { name: 'Limit' }),
    ),
  );
  const price = ticket.getByRole('textbox', { name: 'Price (₹)' });
  await expect(price).toHaveValue(/^\d+\.\d{2}$/);
  const limit = Math.round(Number(await price.inputValue()) * 0.995 * 20) / 20;
  await price.fill(limit.toFixed(2));
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('3');
  await touch.tap(await centreOf(ticket.getByRole('button', { name: 'Buy INFY' })));
  await touch.tap(await centreOf(ticket.getByRole('button', { name: 'Confirm' })));
  await expect(ticket).toBeHidden();
  const line = figure.locator('[data-testid="chart-handle"][data-tone="buy"]');
  await expect(line).toContainText('Buy 3 @ ₹');
  return line;
}

test.describe(`chart gestures by touch (T20, SPEC-TFC-1 §9.1) ${TOUCH_TAG}`, () => {
  test.setTimeout(120_000);

  test('pinch on the plot zooms time', async ({ page }) => {
    const chart = await openChart(page);
    test.skip(!chart.touch.multiTouch, NEEDS_REAL_TOUCH);
    await chart.settle();
    const before = await chart.timeAxis();
    await chart.touch.pinch(await centreOf(chart.host), 40, 240);
    await expect.poll(async () => (await chart.timeAxis()).equals(before)).toBe(false);
  });

  test('a one-finger horizontal drag on the plot pans time and trades nothing', async ({
    page,
  }) => {
    const chart = await openChart(page);
    test.skip(!chart.touch.multiTouch, NEEDS_PINCH);
    const sent = orderRequests(page);
    await zoomIn(chart);
    const before = await chart.timeAxis();
    const centre = await centreOf(chart.host);
    await chart.touch.drag(centre, { x: centre.x + 150, y: centre.y });
    await expect.poll(async () => (await chart.timeAxis()).equals(before)).toBe(false);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(sent).toEqual([]);
  });

  test('a vertical drag on the plot scrolls the page', async ({ page }) => {
    const chart = await openChart(page);
    test.skip(!chart.touch.multiTouch, NEEDS_REAL_TOUCH);
    await page.evaluate(() => window.scrollTo(0, 0));
    const centre = await centreOf(chart.host);
    const scrolled = await page.evaluate(() => window.scrollY);
    await chart.touch.drag(centre, { x: centre.x, y: centre.y - 200 }, 10);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled);
  });

  test('a long-press on the plot shows the crosshair and never trades', async ({ page }) => {
    const chart = await openChart(page);
    const sent = orderRequests(page);
    await chart.touch.longPress(await centreOf(chart.host));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(chart.figure.getByTestId('chart-handle')).toHaveCount(0);
    expect(sent).toEqual([]);
  });

  test('a tap on the empty gutter puts a ghost line there; dragging its handle moves it and not the chart', async ({
    page,
  }) => {
    const chart = await openChart(page);
    const sent = orderRequests(page);
    const lane = await chart.gutter.boundingBox();
    if (!lane) throw new Error('no gutter');
    await chart.touch.tap({ x: lane.x + lane.width / 2, y: lane.y + lane.height * 0.7 });
    const ghost = chart.figure.locator('[data-testid="chart-handle"][data-tone="ghost"]');
    await expect(ghost).toHaveText(/New order @ ₹/);
    const tapped = rupees(await ghost.innerText());

    await chart.settle();
    const axis = await chart.timeAxis();
    const from = await centreOf(ghost);
    await chart.touch.drag(from, { x: from.x - 40, y: from.y - 30 });
    expect(rupees(await ghost.innerText())).toBeGreaterThan(tapped);
    // WebKit's drag is a mouse, which leaves the crosshair's date label on the axis: move it off.
    if (!chart.touch.multiTouch) await page.mouse.move(0, 0);
    await expect.poll(async () => (await chart.timeAxis()).equals(axis)).toBe(true);
    expect(sent).toEqual([]);
  });

  test('tapping the position chip opens the trailing-stop sheet; a drag from it pans instead', async ({
    page,
  }) => {
    const chart = await openChart(page);
    const bar = page.getByRole('group', { name: 'Trade INFY' });
    await chart.touch.tap(await centreOf(bar.getByRole('button', { name: 'Buy INFY' })));
    const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
    await ticket.getByRole('textbox', { name: 'Quantity' }).fill('2');
    await chart.touch.tap(await centreOf(ticket.getByRole('button', { name: 'Buy INFY' })));
    await chart.touch.tap(await centreOf(ticket.getByRole('button', { name: 'Confirm' })));
    await expect(ticket).toBeHidden();
    const chip = chart.figure.locator('[data-testid="chart-handle"][data-tone="position"]');
    await expect(chip).toHaveText(/\+2 @ ₹/);
    // Tapping the chip works everywhere; the pan from it needs a zoom first (Chromium).
    await chart.touch.tap(await centreOf(chip));
    const sheet = page.getByRole('dialog', { name: 'Trailing stop · INFY' });
    await expect(sheet).toBeVisible();
    // On a loaded runner the sheet can still be opening when the first Escape lands: press again.
    await expect(async () => {
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden({ timeout: 1_000 });
    }).toPass();
    if (!chart.touch.multiTouch) return;

    await zoomIn(chart);
    const before = await chart.timeAxis();
    const at = await centreOf(chip);
    await chart.touch.drag(at, { x: at.x - 160, y: at.y });
    await expect.poll(async () => (await chart.timeAxis()).equals(before)).toBe(false);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await chart.touch.tap(await centreOf(chip));
    await expect(page.getByRole('dialog', { name: 'Trailing stop · INFY' })).toBeVisible();
  });

  test('two taps on × cancel an order line', async ({ page }) => {
    const chart = await openChart(page);
    await placeBuyLimit(chart);
    const cross = chart.figure.getByTestId('chart-handle-action');
    await chart.touch.tap(await centreOf(cross));
    await expect(cross).toHaveText('Cancel?');
    await chart.touch.tap(await centreOf(cross));
    await expect(
      page.getByRole('status').filter({ hasText: 'Order cancelled' }).first(),
    ).toBeVisible();
    await expect(chart.figure.getByTestId('chart-handle')).toHaveCount(0);
  });

  test('a drag released back near its start sends nothing and restores the line', async ({
    page,
  }) => {
    const chart = await openChart(page);
    const line = await placeBuyLimit(chart);
    const placed = rupees(await line.innerText());
    const sent = orderRequests(page);
    const from = await centreOf(line);
    const finger = await chart.touch.press(from);
    await finger.move({ x: from.x, y: from.y - 30 });
    expect(rupees(await line.innerText())).toBeGreaterThan(placed);
    await finger.move({ x: from.x, y: from.y - 3 });
    await finger.release();
    await expect.poll(async () => rupees(await line.innerText())).toBe(placed);
    await page.waitForTimeout(500);
    expect(sent).toEqual([]);
  });

  test('a second finger mid-drag cancels the drag and restores the line', async ({ page }) => {
    const chart = await openChart(page);
    test.skip(!chart.touch.multiTouch, NEEDS_REAL_TOUCH);
    const line = await placeBuyLimit(chart);
    const placed = rupees(await line.innerText());
    const sent = orderRequests(page);
    const from = await centreOf(line);
    const finger = await chart.touch.press(from);
    await finger.move({ x: from.x, y: from.y - 40 });
    expect(rupees(await line.innerText())).toBeGreaterThan(placed);
    const plot = await centreOf(chart.host);
    await finger.addFinger({ x: plot.x - 100, y: plot.y });
    await expect.poll(async () => rupees(await line.innerText())).toBe(placed);
    await page.waitForTimeout(500);
    expect(sent).toEqual([]);
  });
  test('a press beside an order line, off its label, holds and drags the line; the crosshair, the chart and the page stay still (CR-T05, AC-01, AC-02)', async ({
    page,
  }) => {
    const chart = await openChart(page);
    const line = await placeBuyLimit(chart);
    const placed = rupees(await line.innerText());
    const id = await line.getAttribute('data-line');
    const band = chart.figure.locator(`[data-testid="chart-grab-band"][data-line="${id ?? ''}"]`);
    await chart.settle();
    const axis = await chart.timeAxis();
    const scrolled = await page.evaluate(() => window.scrollY);
    const plot = await chart.host.boundingBox();
    const reach = await band.boundingBox();
    if (!plot || !reach) throw new Error('no chart');
    // The audit's near miss: on the left of the plot, far from the label, 12 px off the line,
    // held past the chart's long-press time before moving.
    const from = { x: plot.x + 60, y: reach.y + reach.height / 2 + 12 };
    const finger = await chart.touch.press(from);
    await page.waitForTimeout(400);
    await finger.move({ x: from.x + 40, y: from.y - 40 }, 8);
    expect(rupees(await line.innerText())).toBeGreaterThan(placed);
    // No crosshair date label, no pan and no page scroll while the line is held.
    expect((await chart.timeAxis()).equals(axis)).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    await finger.release();
    if (!chart.touch.multiTouch) await page.mouse.move(0, 0);
    await expect.poll(async () => rupees(await line.innerText())).toBeGreaterThan(placed);
    await expect.poll(async () => (await chart.timeAxis()).equals(axis)).toBe(true);
  });
});

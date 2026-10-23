import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { JOURNEY_TAG } from './support/env';
import { setPrice } from './support/testControls';
import { centreOf, touchscreen, type Point } from './support/touch';

// T26 (SPEC-TFC-1 §4.2, REQ-DEL-03): the five journeys end to end, on every project: desktop
// Chrome (1440 px, mouse), Chromium mobile (390 × 844, touch) and, in CI, WebKit on an iPhone 13.
// The scalper is the phone layout, so US-05 runs on the touch projects, and once more at 360 px.
//
// Prices are pinned with the test control (`setPrice`), so fills and the trailing stop's
// ratchet and trigger happen when the journey says, not when the random walk gets there. The page
// clock is fixed at Monday 28 Sep 2026, 10:00 IST, so NSE is open for the paper engine.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

const rupees = (text: string) => {
  const match = /₹([\d,]+\.\d\d)/.exec(text);
  if (!match?.[1]) throw new Error(`no price in "${text}"`);
  return Number(match[1].replaceAll(',', ''));
};
const paise = (rupeeValue: number) => Math.round((rupeeValue * 100) / 5) * 5;

/** Taps on a touch project, clicks on the desktop one. */
type Input = {
  touch: boolean;
  press: (target: Locator) => Promise<void>;
  tapAt: (at: Point) => Promise<void>;
  drag: (from: Point, to: Point) => Promise<void>;
};

async function inputFor(page: Page, testInfo: TestInfo): Promise<Input> {
  if (testInfo.project.use.hasTouch) {
    const touch = await touchscreen(page);
    return {
      touch: true,
      // Playwright's own tap waits until the target is visible, stable and the one hit at its
      // centre: handles move with every chart repaint, so a tap at a stale centre can miss.
      press: (target) => target.tap(),
      tapAt: (at) => touch.tap(at),
      drag: (from, to) => touch.drag(from, to),
    };
  }
  return {
    touch: false,
    press: (target) => target.click(),
    tapAt: (at) => page.mouse.click(at.x, at.y),
    drag: async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
    },
  };
}

async function openInfy(page: Page, viewport: { width: number; height: number }) {
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize(viewport);
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  const figure = page.getByRole('figure', { name: /INFY area chart/ });
  await expect(figure.getByTestId('chart-gutter')).toBeVisible();
  return figure;
}

const viewportOf = (testInfo: TestInfo) =>
  testInfo.project.use.viewport ?? { width: 1440, height: 900 };

test.describe(`journeys US-01 to US-05 (T26) ${JOURNEY_TAG}`, () => {
  test.setTimeout(150_000);

  test('US-01 to US-04: drag a limit onto the chart with a trailing stop, fill, ratchet, trigger and exit', async ({
    page,
  }, testInfo) => {
    const viewport = testInfo.project.use.hasTouch
      ? viewportOf(testInfo)
      : { width: 1440, height: 900 };
    const figure = await openInfy(page, viewport);
    const input = await inputFor(page, testInfo);

    // US-01: a tap on the price gutter puts a ghost line low in the pane; drag it up a little.
    const gutter = figure.getByTestId('chart-gutter');
    await gutter.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const lane = await gutter.boundingBox();
    if (!lane) throw new Error('no gutter');
    await input.tapAt({ x: lane.x + lane.width / 2, y: lane.y + lane.height * 0.8 });
    const ghost = figure.locator('[data-testid="chart-handle"][data-tone="ghost"]');
    await expect(ghost).toHaveText(/New order @ ₹/);
    const tapped = rupees(await ghost.innerText());
    const from = await centreOf(ghost);
    await input.drag(from, { x: from.x - 30, y: from.y - 20 });
    await expect.poll(async () => rupees(await ghost.innerText())).toBeGreaterThan(tapped);
    const limit = rupees(await ghost.innerText());

    // US-02: Buy from the ghost opens the compact ticket at that price; attach a 1% trailing stop.
    await input.press(figure.getByRole('button', { name: /^Buy at ₹.*review before placing$/ }));
    const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
    await expect(ticket.getByRole('textbox', { name: 'Price (₹)' })).toHaveValue(limit.toFixed(2));
    await input.press(ticket.getByRole('switch', { name: 'Add trailing stop' }));
    await ticket.getByRole('textbox', { name: 'Trail (%)' }).fill('1');
    await ticket.getByRole('textbox', { name: 'Quantity' }).fill('4');
    await input.press(ticket.getByRole('button', { name: 'Buy INFY' }));
    await input.press(ticket.getByRole('button', { name: 'Confirm' }));
    await expect(ticket).toBeHidden();
    const line = figure.locator('[data-testid="chart-handle"][data-tone="buy"]');
    await expect(line).toContainText('Buy 4 @ ₹');
    expect(rupees(await line.innerText())).toBe(limit);

    // US-03: the price comes down to the limit, the entry fills, and the position chip appears.
    // Tapping the chip opens the trailing-stop sheet for the position, with the attached stop.
    await setPrice(page, 'INFY', paise(limit * 0.995));
    const chip = figure.locator('[data-testid="chart-handle"][data-tone="position"]');
    await expect(chip).toHaveText(/\+4 @ ₹/, { timeout: 15_000 });
    await expect(line).toHaveCount(0);
    const stop = figure.locator('[data-testid="chart-handle"][data-tone="trailing"]');
    await expect(stop).toHaveText(/Trailing SL ₹[\d,]+\.\d\d · 1% · Trailing$/, {
      timeout: 15_000,
    });
    await input.press(chip);
    const sheet = page.getByRole('dialog', { name: 'Trailing stop · INFY' });
    await expect(sheet.getByRole('button', { name: 'Update trailing stop' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // US-04: a 3% rally raises the stop; a 1% pullback leaves it where it is.
    const placed = rupees(await stop.innerText());
    await setPrice(page, 'INFY', paise(limit * 1.03));
    await expect
      .poll(async () => rupees(await stop.innerText()), { timeout: 15_000 })
      .toBeGreaterThan(placed);
    const raised = rupees(await stop.innerText());
    await setPrice(page, 'INFY', paise(limit * 1.02));
    await page.waitForTimeout(1_500);
    expect(rupees(await stop.innerText())).toBe(raised);

    // Then the price falls through the stop: it triggers, the exit sells the 4 shares and the
    // position is flat.
    await setPrice(page, 'INFY', paise(raised * 0.98));
    await expect(chip).toHaveCount(0, { timeout: 15_000 });
    await expect(stop).toHaveCount(0);
  });

  test('US-05: scalp from the pad: arm, buy in one tap, flatten in one tap', async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'The scalper is the phone layout');
    await scalpJourney(page, testInfo, viewportOf(testInfo));
  });

  test('US-05 at 360 px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'One narrow run, on Chromium mobile');
    await scalpJourney(page, testInfo, { width: 360, height: 780 });
  });
});

async function scalpJourney(
  page: Page,
  testInfo: TestInfo,
  viewport: { width: number; height: number },
) {
  await openInfy(page, viewport);
  const input = await inputFor(page, testInfo);
  // Nothing on the page is wider than the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width,
  );
  await input.press(page.getByRole('switch', { name: 'Scalp' }));
  const pad = page.getByRole('region', { name: 'Scalper for INFY' });
  await input.press(pad.getByRole('radio', { name: '5 shares', exact: true }));
  await input.press(pad.getByRole('switch', { name: 'Arm' }));
  const buy = pad.getByTestId('scalp-buy');
  await expect(buy).toContainText(/Buy at ask\s*₹[\d,]+\.\d\d/);
  // The engine's price a little under the ask, so the IOC buy at the ask fills at once.
  await setPrice(page, 'INFY', paise(rupees(await buy.innerText()) * 0.97));
  await input.press(buy);
  const ack = pad.getByRole('status', { name: 'Last scalp order' });
  await expect(ack).toHaveText(/^Bought 5 @ ₹/);
  const strip = page.getByTestId('position-strip');
  await expect(strip).toContainText(/\+5\s*@ ₹/);
  await input.press(pad.getByTestId('scalp-flatten'));
  await expect(ack).toHaveText(/^Closed: sold 5 @ ₹/);
  await expect(strip).toHaveCount(0);
  for (const target of [buy, pad.getByTestId('scalp-sell'), pad.getByTestId('scalp-flatten')]) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0, 'pad targets are at least 44 px tall').toBeGreaterThanOrEqual(44);
  }
}

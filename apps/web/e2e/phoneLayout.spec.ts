import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';

// T12 (SPEC-TFC-1 §9.4, REQ-MOB-04, REQ-MOB-06): the instrument page on a phone is its own layout.
// At 360, 390 and 414 px: no sideways scroll, every control on it at least 44 px, Sell and Buy in
// the lower 40% of the screen, depth in its own tab; and the ticket and the trailing-stop options
// rise as bottom sheets, and the scalper pad sits at the bottom with the same 44 px targets.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so the in-browser paper engine sees
// NSE open and a market buy fills.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');
const PHONES = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
] as const;
const MIN_TARGET = 44;

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('element has no box');
  return rect;
}

async function expectTargets(locators: Locator[]) {
  for (const locator of locators) {
    for (const item of await locator.all()) {
      const rect = await box(item);
      const name = (await item.getAttribute('aria-label')) ?? (await item.innerText());
      expect(rect.height, name).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(rect.width, name).toBeGreaterThanOrEqual(MIN_TARGET);
    }
  }
}

const tradeBar = (page: Page) => page.getByRole('group', { name: 'Trade INFY' });

for (const viewport of PHONES) {
  test(`phone instrument layout at ${String(viewport.width)} px (T12)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/stocks/INFY');
    await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();
    await expect(page.locator('[data-layout="phone"]')).toBeVisible();
    await expect(
      page.getByRole('figure', { name: 'INFY area chart over 1 day' }).locator('canvas').first(),
    ).toBeVisible();

    const tabs = page.getByRole('tablist', { name: 'Stock details' });
    await expect(tabs.getByRole('tab')).toHaveText(['Overview', 'Depth', 'Orders']);
    await expect(page.getByRole('region', { name: 'Key stats' })).toBeVisible();

    // Sell and Buy sit in the lower 40% of the screen, side by side, edge to edge.
    const sell = tradeBar(page).getByRole('button', { name: 'Sell INFY' });
    const buy = tradeBar(page).getByRole('button', { name: 'Buy INFY' });
    for (const action of [sell, buy]) {
      await expect(action).toBeInViewport();
      expect((await box(action)).y).toBeGreaterThanOrEqual(viewport.height * 0.6);
    }

    await expectTargets([
      tabs.getByRole('tab'),
      tradeBar(page).getByRole('button'),
      page.getByRole('radiogroup', { name: 'Chart range' }).getByRole('radio'),
      page.getByRole('radiogroup', { name: 'Chart type' }).getByRole('radio'),
      page.getByRole('radiogroup', { name: 'Exchange' }).getByRole('radio'),
    ]);

    // The chart controls wrap rather than squeeze: in each group no segment overlaps the next,
    // so "Candles" is never cut off (NSTOCK-0337). Each group ends within the chart's width.
    const chart = await box(page.getByRole('figure', { name: 'INFY area chart over 1 day' }));
    for (const name of ['Chart range', 'Chart type']) {
      let previousEnd = -Infinity;
      for (const segment of await page.getByRole('radiogroup', { name }).getByRole('radio').all()) {
        const rect = await box(segment);
        const label = await segment.innerText();
        expect(rect.x, label).toBeGreaterThanOrEqual(previousEnd);
        expect(rect.x + rect.width, label).toBeLessThanOrEqual(chart.x + chart.width);
        previousEnd = rect.x + rect.width;
      }
    }

    // Depth is a tab on a phone, not a card in the scroll.
    await expect(page.getByRole('region', { name: 'Market depth' })).toHaveCount(0);
    await tabs.getByRole('tab', { name: 'Depth' }).click();
    const depth = page.getByRole('region', { name: 'Market depth' });
    await expect(depth.getByRole('table', { name: 'Bids (buy orders)' })).toBeVisible();
    await expect(depth.locator('tbody tr').first()).toContainText(/₹[\d,]+\.\d{2}/);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('on a phone the ticket is a bottom sheet and a fill shows in the position strip (T12)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  await expect(page.getByTestId('position-strip')).toHaveCount(0);

  await tradeBar(page).getByRole('button', { name: 'Buy INFY' }).click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toHaveAttribute('data-side', 'bottom');
  // Full width and resting on the bottom edge once it has slid up.
  await expect
    .poll(async () => {
      const sheet = await box(ticket);
      return [sheet.width, Math.round(sheet.y + sheet.height)];
    })
    .toEqual([390, 844]);
  // Every control in the sheet is a thumb-sized target: steppers, segments, switch, depth prices.
  // Depth and the attached stop are behind "More options" on a phone (CR-T11).
  await ticket.getByRole('button', { name: /^More options/ }).click();
  await expect(ticket.getByRole('button', { name: /use as limit price$/ }).first()).toBeVisible();
  await expectTargets([
    ticket.getByRole('button'),
    ticket.getByRole('radio'),
    ticket.getByRole('switch'),
    ticket.getByRole('textbox'),
  ]);

  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('2');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();

  // The position strip above Sell and Buy: quantity, average and live P&L.
  const strip = page.getByTestId('position-strip');
  await expect(strip).toContainText(/\+2\s*@ ₹[\d,]+\.\d{2}/);
  expect((await box(strip)).y).toBeGreaterThanOrEqual(844 * 0.6);

  await page
    .getByRole('tablist', { name: 'Stock details' })
    .getByRole('tab', { name: 'Orders' })
    .click();
  await expect(page.getByRole('list', { name: "Today's INFY orders" })).toContainText(
    /Buy 2 \/ 2 · Market/,
  );

  // Tapping the strip raises the trailing-stop options as a bottom sheet, every control in reach.
  await strip.getByRole('button').click();
  const sheet = page.getByRole('dialog', { name: 'Trailing stop · INFY' });
  await expect(sheet).toHaveAttribute('data-side', 'bottom');
  await expect
    .poll(async () => {
      const rect = await box(sheet);
      return [rect.width, Math.round(rect.y + rect.height)];
    })
    .toEqual([390, 844]);
  await expectTargets([
    sheet.getByRole('button'),
    sheet.getByRole('radio'),
    sheet.getByRole('textbox'),
  ]);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // The scalper pad takes the place of Sell and Buy at the bottom, with the same 44 px targets.
  await page.getByRole('switch', { name: 'Scalp' }).click();
  const pad = page.getByRole('region', { name: 'Scalper for INFY' });
  await expect(pad).toBeVisible();
  expect((await box(pad.getByTestId('scalp-buy'))).y).toBeGreaterThanOrEqual(844 * 0.6);
  await expectTargets([pad.getByRole('button'), pad.getByRole('radio'), pad.getByRole('switch')]);
});

// SPEC-CR-1 AC-07: the primary action stays on screen with the keyboard open. Chromium has no
// on-screen keyboard, so a stand-in visual viewport (400 px tall, the rest covered) is installed
// before the page loads and told to resize when an input takes focus.
test('the ticket primary button stays in view with the keyboard open (CR-T11, AC-07)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    document.addEventListener('focusin', (event) => {
      if (event.target instanceof HTMLInputElement) {
        viewport.height = 400;
        viewport.dispatchEvent(new Event('resize'));
      }
    });
  });
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await tradeBar(page).getByRole('button', { name: 'Buy INFY' }).click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await ticket.getByRole('textbox', { name: 'Quantity' }).focus();
  await expect(ticket).toHaveAttribute('data-keyboard', 'open');
  const submit = ticket.getByTestId('ticket-primary').getByRole('button', { name: 'Buy INFY' });
  await expect(submit).toBeInViewport();
  const rect = await box(submit);
  expect(rect.y + rect.height).toBeLessThanOrEqual(400);
});

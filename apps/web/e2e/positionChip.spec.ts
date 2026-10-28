import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';

// T18 (SPEC-TFC-1 §8.1, §8.4, §9.1, REQ-TFC-04, REQ-TFC-06): an open position is a chip on the
// chart at its average, with a P&L that follows the price. A drag that starts on the chip pans the
// chart; a tap opens the trailing-stop sheet, which sets, updates and cancels the stop. Desktop
// and phone.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so NSE is open for the paper engine.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('element has no box');
  return rect;
}

async function buyAtMarket(page: Page, phone: boolean) {
  const buy = phone
    ? page.getByRole('group', { name: 'Trade INFY' }).getByRole('button', { name: 'Buy INFY' })
    : page.getByRole('button', { name: 'Buy INFY' });
  await buy.click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('4');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();
}

for (const viewport of VIEWPORTS) {
  test(`position chip: live P&L, pan, and set, update and cancel a trailing stop on the ${viewport.name} chart (T18)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.clock.setFixedTime(MONDAY_10_IST);
    await page.setViewportSize(viewport);
    await page.goto('/login?redirect=%2Fstocks%2FINFY');
    await logIn(page, uniqueMobile());
    await expect(page).toHaveURL(/\/stocks\/INFY$/);
    const figure = page.getByRole('figure', { name: /INFY area chart/ });
    await expect(figure.getByTestId('chart-gutter')).toBeVisible();

    await buyAtMarket(page, viewport.name === 'phone');
    const chip = figure.locator('[data-testid="chart-handle"][data-tone="position"]');
    await expect(chip).toHaveText(/\+4 @ ₹[\d,]+\.\d\d · [+-]?₹[\d,]+\.\d\d$/);

    // The P&L follows the live price.
    const first = await chip.innerText();
    await expect.poll(() => chip.innerText(), { timeout: 20_000 }).not.toBe(first);

    // A drag that starts on the chip pans the chart and opens nothing. Zoom in first: with every
    // bar in view, the pinned edges leave nothing to pan to. The phone zooms by pinch only, so
    // here the phone drag is checked to open nothing; chartGestures.spec.ts pinches, then pans
    // from the chip by touch (T20).
    const phone = viewport.name === 'phone';
    const host = figure.getByTestId('chart-host');
    const plot = await box(host);
    await page.mouse.move(plot.x + plot.width / 3, plot.y + plot.height / 2);
    await page.mouse.wheel(0, -600);
    // The time axis only moves on a pan; ticks change prices, not the dates along the bottom.
    const timeAxis = {
      x: plot.x,
      y: plot.y + plot.height - 26,
      width: plot.width - 72,
      height: 26,
    };
    await expect
      .poll(async () => {
        const a = await page.screenshot({ clip: timeAxis });
        await page.waitForTimeout(300);
        return a.equals(await page.screenshot({ clip: timeAxis }));
      })
      .toBe(true);
    const before = await page.screenshot({ clip: timeAxis });
    const at = await box(chip);
    const x = at.x + at.width / 2;
    const y = at.y + at.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 4 });
    await page.mouse.move(x + 160, y, { steps: 4 });
    await page.mouse.up();
    if (!phone) expect((await page.screenshot({ clip: timeAxis })).equals(before)).toBe(false);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Tap: the sheet, with no stop yet and a 1.00% trail. Set it.
    const sheet = page.getByRole('dialog', { name: 'Trailing stop · INFY' });
    await chip.click();
    await expect(sheet.getByTestId('sheet-status')).toHaveText('No trailing stop');
    await expect(sheet.getByRole('textbox', { name: 'Trail (%)' })).toHaveValue('1.00');
    await sheet.getByRole('button', { name: 'Set trailing stop' }).click();
    await expect(sheet).toBeHidden();
    const stop = figure.locator('[data-testid="chart-handle"][data-tone="trailing"]');
    await expect(stop).toHaveText(/Trailing stop ₹[\d,]+\.\d\d · 1% · Trailing$/);

    // Update the trail to 2%.
    await chip.click();
    await expect(sheet.getByTestId('sheet-status')).toHaveText(/^Trailing · stop ₹/);
    await sheet.getByRole('textbox', { name: 'Trail (%)' }).fill('2');
    await sheet.getByRole('button', { name: 'Update trailing stop' }).click();
    await expect(sheet).toBeHidden();
    await expect(stop).toHaveText(/ · 2% · Trailing$/);

    // Cancel it: the stop line goes.
    await chip.click();
    await sheet.getByRole('button', { name: 'Cancel trailing stop' }).click();
    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Trailing stop cancelled' }).first(),
    ).toBeVisible();
    await expect(stop).toHaveCount(0);
  });
}

import { expect, test } from '@playwright/test';
import { logIn } from '../support/auth';
import { touchscreen } from '../support/touch';

// A short phone recording of the flow (CR-T01 for the "before" take, CR-T24 for the "after" take):
// the instrument page, the order ticket scrolled to its button, a limit order placed, then a thumb
// that presses just above the order line's label, holds and drags. Before the craft round that
// press wakes the chart's crosshair and the line stays put (SPEC-CR-1 §3). Playwright records the
// page as WebM in the `recording` project of playwright.design.config.ts.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

test('record the phone flow', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page);
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  const figure = page.getByRole('figure', { name: /INFY .* chart/ });
  await expect(figure.locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(1_500);

  // The page below the fold, then back to the top.
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(1_000);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(800);

  await page
    .getByRole('group', { name: 'Trade INFY' })
    .getByRole('button', { name: 'Buy INFY' })
    .click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket.getByRole('form', { name: 'Order details' })).toBeVisible();
  await page.waitForTimeout(1_200);
  await ticket
    .getByRole('radiogroup', { name: 'Order type' })
    .getByRole('radio', { name: 'Limit' })
    .click();
  const price = ticket.getByRole('textbox', { name: 'Price (₹)' });
  await expect(price).toHaveValue(/^\d+\.\d{2}$/);
  const limit = Math.round(Number(await price.inputValue()) * 0.995 * 20) / 20;
  await price.fill(limit.toFixed(2));
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('4');
  const submit = ticket.getByRole('button', { name: 'Buy INFY' });
  await submit.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_000);
  await submit.click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();

  const line = figure.locator('[data-testid="chart-handle"][data-tone="buy"]');
  await expect(line).toBeVisible();
  await line.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1_000);
  const box = await line.boundingBox();
  if (!box) throw new Error('the order line has no box');

  // A thumb lands 6 px above the label, holds, then drags up.
  const touch = await touchscreen(page);
  const start = { x: box.x + box.width / 2, y: box.y - 6 };
  const finger = await touch.press(start);
  await page.waitForTimeout(400);
  await finger.move({ x: start.x, y: start.y - 60 }, 20);
  await page.waitForTimeout(800);
  await finger.release();
  await page.waitForTimeout(1_500);
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { logIn } from '../support/auth';
import { isTouchViewport, VIEWPORT_MATRIX } from '../support/viewportMatrix';

// The before/after set for DESIGN.md (SPEC-CR-1 §11, CR-T01, G3): the mobile Trade from Charts flow
// at every viewport of the matrix, in three frames: the instrument page as it first shows, the
// order ticket open, and the chart with a working limit order line. Screenshots are the viewport
// only, not the full page, because what fits above the fold is the point. Run it once on the build
// before the craft round (DESIGN_OUT=../../docs/design/before) and once at the end (…/after).
//
//   npx playwright test -c playwright.design.config.ts
//
// A frame that cannot be reached at a viewport (the flow is broken there) is not a failure of the
// capture: it is written to <viewport>.json as a finding, and the run goes on.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so NSE is open for the paper engine.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');
const OUT_DIR = process.env['DESIGN_OUT'] ?? 'test-results/design';

async function shoot(page: Page, file: string) {
  // Let entry motion and the first price ticks settle before the frame.
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT_DIR, file), type: 'jpeg', quality: 72 });
}

async function openBuyTicket(page: Page) {
  const tradeBar = page.getByRole('group', { name: 'Trade INFY' });
  const buy = (await tradeBar.isVisible())
    ? tradeBar.getByRole('button', { name: 'Buy INFY' })
    : page.getByRole('button', { name: 'Buy INFY' }).first();
  await buy.click({ timeout: 10_000 });
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket.getByRole('form', { name: 'Order details' })).toBeVisible();
  return ticket;
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

for (const viewport of VIEWPORT_MATRIX) {
  test.describe(viewport.name, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: isTouchViewport(viewport),
      hasTouch: isTouchViewport(viewport),
      deviceScaleFactor: isTouchViewport(viewport) ? 2 : 1,
    });

    test(`flow at ${viewport.name}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.clock.setFixedTime(MONDAY_10_IST);
      await page.goto('/login?redirect=%2Fstocks%2FINFY');
      await logIn(page);
      await expect(page).toHaveURL(/\/stocks\/INFY$/);
      const figure = page.getByRole('figure', { name: /INFY .* chart/ });
      await expect(figure.locator('canvas').first()).toBeVisible();
      await shoot(page, `${viewport.name}-instrument.jpg`);
      const frames = ['instrument'];
      try {
        await placeOrder(page, frames, viewport.name);
      } catch (error) {
        const message =
          error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
        writeFileSync(
          join(OUT_DIR, `${viewport.name}.json`),
          JSON.stringify({ viewport: viewport.name, frames, blocked: message }, null, 2),
        );
        return;
      }
      writeFileSync(
        join(OUT_DIR, `${viewport.name}.json`),
        JSON.stringify({ viewport: viewport.name, frames }, null, 2),
      );
    });
  });
}

/** Opens the ticket, then places a buy limit half a percent under the market: a chart line. */
async function placeOrder(page: Page, frames: string[], name: string) {
  const figure = page.getByRole('figure', { name: /INFY .* chart/ });
  const ticket = await openBuyTicket(page);
  await shoot(page, `${name}-ticket.jpg`);
  frames.push('ticket');

  await ticket
    .getByRole('radiogroup', { name: 'Order type' })
    .getByRole('radio', { name: 'Limit' })
    .click();
  const price = ticket.getByRole('textbox', { name: 'Price (₹)' });
  await expect(price).toHaveValue(/^\d+\.\d{2}$/);
  const limit = Math.round(Number(await price.inputValue()) * 0.995 * 20) / 20;
  await price.fill(limit.toFixed(2));
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('4');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden({ timeout: 10_000 });
  const line = figure.locator('[data-testid="chart-handle"][data-tone="buy"]');
  await expect(line).toBeVisible();
  await line.scrollIntoViewIfNeeded();
  await shoot(page, `${name}-orderLine.jpg`);
  frames.push('orderLine');
}

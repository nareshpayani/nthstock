import { expect, test, type Page } from '@playwright/test';
import { logIn } from './support/auth';

// CR-T15 (SPEC-CR-1 §6.2): from 600 to 1023 px the order ticket docks beside the page instead of
// covering it, and the page narrows to make room, so the chart stays in view and in use; a phone
// turned sideways gets the phone page with a one-line price block, a chart that fills the height
// between the app bar and the dock, and a full-height ticket with its button pinned.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so NSE is open for the paper engine.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

async function openInfy(page: Page) {
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page);
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  await expect(
    page
      .getByRole('figure', { name: /INFY .* chart/ })
      .locator('canvas')
      .first(),
  ).toBeVisible();
}

for (const viewport of [
  { width: 820, height: 1180, name: 'tablet' },
  { width: 673, height: 841, name: 'unfolded foldable' },
]) {
  test.describe(`docked ticket on a ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: true,
      hasTouch: true,
    });

    test(`the ticket docks beside the page at ${String(viewport.width)} px`, async ({ page }) => {
      await openInfy(page);
      const figure = page.getByRole('figure', { name: /INFY .* chart/ });
      await page.getByRole('button', { name: 'Buy INFY' }).first().click();
      const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
      await expect(ticket).toBeVisible();
      await expect(ticket).toHaveAttribute('data-docked', 'true');
      // No overlay: the page narrows beside the panel instead.
      await expect(page.locator('[data-overlay]')).toHaveCount(0);
      // Once it has slid in, it ends at the screen's right edge and the chart ends where it starts.
      await expect
        .poll(async () => {
          const box = await ticket.boundingBox();
          return box ? Math.round(box.x + box.width) : 0;
        })
        .toBe(viewport.width);
      const panel = await ticket.boundingBox();
      if (!panel) throw new Error('no ticket box');
      await expect
        .poll(async () => {
          const box = await figure.boundingBox();
          return box ? box.x + box.width : Infinity;
        })
        .toBeLessThanOrEqual(panel.x + 2);
      // The page stays in use: changing the chart range leaves the ticket open.
      await page.getByRole('radio', { name: '1W' }).click();
      await expect(page).toHaveURL(/range=1W/);
      await expect(ticket).toBeVisible();
      // Esc closes it, and the page takes the full width again.
      await ticket.getByRole('textbox', { name: 'Quantity' }).focus();
      await page.keyboard.press('Escape');
      await expect(ticket).toBeHidden();
      await expect(page.locator('#main')).not.toHaveAttribute('data-docked');
    });
  });
}

test.describe('phone in landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('one-line price, a chart that fills the height, and a full-height ticket', async ({
    page,
  }) => {
    await openInfy(page);
    await expect(page.locator('[data-layout="landscape"]')).toBeVisible();
    const block = page.locator('[data-part="price-block"]');
    const blockBox = await block.boundingBox();
    expect(blockBox?.height).toBeLessThanOrEqual(56);
    const figure = await page.getByRole('figure', { name: /INFY .* chart/ }).boundingBox();
    expect(figure?.height).toBe(390 - 168);

    const tradeBar = page.getByRole('group', { name: 'Trade INFY' });
    await tradeBar.getByRole('button', { name: 'Buy INFY' }).click();
    const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
    await expect(ticket).toBeVisible();
    const sheet = await ticket.boundingBox();
    expect(sheet?.height).toBeCloseTo(390, 0);
    expect(sheet?.width).toBeLessThanOrEqual(560);
    await expect(ticket.getByRole('button', { name: 'Buy INFY' })).toBeInViewport();
  });
});

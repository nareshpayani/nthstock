import { expect, test } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { TOUCH_TAG } from './support/env';
import { centreOf, touchscreen } from './support/touch';

// T04 (SPEC-TFC-1 §13, REQ-MOB-05): the phone buy journey from T12, driven by touch on the touch
// projects (Chromium mobile at 390 × 844 and, when WebKit is installed, an iPhone 13). Every
// control is tapped, not clicked, and on Chromium the taps arrive as real touch pointers.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so the in-browser paper engine sees
// NSE open and a market buy fills.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

test(`a phone buy by touch: ticket sheet, fill and position strip (T04) ${TOUCH_TAG}`, async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  const touch = await touchscreen(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');

  // Record how the first tap arrives: a touch pointer on Chromium.
  await page.evaluate(() => {
    document.addEventListener(
      'pointerdown',
      (event) => document.body.setAttribute('data-last-pointer', event.pointerType),
      true,
    );
  });
  const buy = page
    .getByRole('group', { name: 'Trade INFY' })
    .getByRole('button', { name: 'Buy INFY' });
  await touch.tap(await centreOf(buy));
  if (browserName === 'chromium') {
    await expect(page.locator('body')).toHaveAttribute('data-last-pointer', 'touch');
  }

  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toHaveAttribute('data-side', 'bottom');
  await expect
    .poll(async () => {
      const sheet = await ticket.boundingBox();
      return sheet ? [Math.round(sheet.width), Math.round(sheet.y + sheet.height)] : null;
    })
    .toEqual([viewport.width, viewport.height]);

  const qty = ticket.getByRole('textbox', { name: 'Quantity' });
  await touch.tap(await centreOf(qty));
  await qty.fill('2');
  await touch.tap(await centreOf(ticket.getByRole('button', { name: 'Buy INFY' })));
  await touch.tap(await centreOf(ticket.getByRole('button', { name: 'Confirm' })));
  await expect(ticket).toBeHidden();

  const strip = page.getByTestId('position-strip');
  await expect(strip).toContainText(/\+2\s*@ ₹[\d,]+\.\d{2}/);
});

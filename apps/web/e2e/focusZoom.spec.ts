import { expect, test, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { TOUCH_TAG } from './support/env';

// NSTOCK-0479: a phone browser zooms the page into a focused text field under 16 px and leaves it
// zoomed and cut off. The fields that take focus on their own (login, the Trade search, the
// ticket's quantity) and every other text field on the way must be 16 px or more on a touch
// screen. Runs on the touch projects (Chromium as a Pixel, WebKit as an iPhone when installed).

const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

/** Text fields on screen under 16 px, as "label: size". */
function smallFields(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('input, select, textarea')]
      .filter((field) => {
        const type = field.getAttribute('type') ?? 'text';
        if (['checkbox', 'radio', 'range', 'color', 'hidden'].includes(type)) return false;
        const box = field.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((field) => ({
        label:
          field.getAttribute('aria-label') ?? field.getAttribute('name') ?? field.id ?? 'field',
        size: Number.parseFloat(getComputedStyle(field).fontSize),
      }))
      .filter(({ size }) => size < 16)
      .map(({ label, size }) => `${label}: ${String(size)} px`),
  );
}

test(`text fields never make a phone zoom in (NSTOCK-0479) ${TOUCH_TAG}`, async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await expect(page.getByRole('textbox', { name: 'Mobile number' })).toBeFocused();
  expect(await smallFields(page), 'login').toEqual([]);
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);

  // The order ticket focuses its quantity.
  await page
    .getByRole('group', { name: 'Trade INFY' })
    .getByRole('button', { name: 'Buy INFY' })
    .click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();
  await ticket
    .getByRole('radiogroup', { name: 'Order type' })
    .getByRole('radio', { name: 'Limit' })
    .click();
  expect(await smallFields(page), 'order ticket').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(ticket).toBeHidden();

  // The Trade sheet focuses its search box.
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /^Trade: search a stock/ }).click();
  await expect(page.getByRole('dialog').last().getByRole('combobox').first()).toBeFocused();
  expect(await smallFields(page), 'Trade sheet').toEqual([]);

  // The viewport was never zoomed.
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
});

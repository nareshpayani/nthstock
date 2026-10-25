import { TICK_SIZE_PAISE } from '@nthstock/contracts';
import { expect, test } from '@playwright/test';
import { logIn } from './support/auth';
import { API_TAG } from './support/env';
import {
  MONDAY_10_00_IST,
  rupees,
  scriptedPrices,
  setClock,
  setPrice,
} from './support/testControls';

// NSTOCK-0384: a fill reaches the bell over the WebSocket push, with no poll and no reload. A limit
// buy rests Open, a scripted price crosses it, and the unread bell and the toast appear on the
// same page load.

test(`a fill notification arrives live without a reload ${API_TAG}`, async ({ page }) => {
  test.setTimeout(150_000);
  await setClock(page, MONDAY_10_00_IST);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/stocks/INFY');
  await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();
  const { base, below } = await scriptedPrices(page, 'INFY');
  await setPrice(page, 'INFY', base);
  await page.getByRole('button', { name: 'Buy INFY' }).click();
  await logIn(page);
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();

  await ticket.getByRole('radio', { name: 'Limit' }).click();
  await ticket.getByRole('textbox', { name: 'Price (₹)' }).fill(rupees(below));
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('1');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();
  // Signing in can raise its own notice (a new-device sign-in), so count from what is unread now.
  const bell = page.getByRole('button', { name: /^Notifications(, \d+ unread)?$/ });
  await expect(bell).toBeVisible();
  const unreadBefore = Number(
    (await bell.getAttribute('aria-label'))?.match(/(\d+) unread/)?.[1] ?? 0,
  );

  // A marker on window: a reload would lose it.
  await page.evaluate(() => Object.assign(window, { noReloadMarker: true }));

  await setPrice(page, 'INFY', below - TICK_SIZE_PAISE);
  await expect(
    page.getByRole('button', { name: `Notifications, ${String(unreadBefore + 1)} unread` }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Order executed').first()).toBeVisible();
  expect(await page.evaluate(() => 'noReloadMarker' in window)).toBe(true);
});

import { expect, test, type Page } from '@playwright/test';

// T-135 to T-140: the order ticket journey in msw mode. A signed-out Buy on stock detail goes
// through login and the ticket opens on return; Esc closes it with focus back on Buy; a market
// buy is reviewed, confirmed and shows the success toast with a link to the order book.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so the in-browser paper engine sees
// NSE open (the order fills instead of becoming an AMO) whatever day the suite runs on.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

async function logIn(page: Page) {
  await page.getByRole('textbox', { name: 'Mobile number' }).fill('9876598765');
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await page.getByRole('group', { name: 'One-time password' }).getByRole('textbox').first().click();
  await page.keyboard.type('123456');
  await page.getByRole('button', { name: 'Skip for now' }).click();
}

test('buy INFY at market from stock detail through login, review and confirm', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/stocks/INFY');
  await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();

  // Signed out: Buy goes to login and comes back with the ticket open.
  await page.getByRole('button', { name: 'Buy INFY' }).click();
  await expect(page).toHaveURL(/\/login\?redirect=%2Fstocks%2FINFY/);
  await logIn(page);
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();
  const qty = ticket.getByRole('textbox', { name: 'Quantity' });
  await expect(qty).toBeFocused();

  // The chart and the watchlist rail stay on screen beside the slide-over (hidden from assistive
  // tech while the ticket is open, so located by CSS), and the ticket does not cover the chart.
  const chart = page.locator('figure canvas').first();
  await expect(chart).toBeInViewport();
  await expect(page.locator('aside[aria-label="Watchlist and search"]')).toBeInViewport();
  const chartBox = await chart.boundingBox();
  const ticketBox = await ticket.boundingBox();
  expect(chartBox && ticketBox && chartBox.x < ticketBox.x).toBe(true);

  // Esc closes it and focus goes back to Buy.
  await page.keyboard.press('Escape');
  await expect(ticket).toBeHidden();
  const buy = page.getByRole('button', { name: 'Buy INFY' });
  await buy.focus();
  await page.keyboard.press('Enter');
  await expect(ticket).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ticket).toBeHidden();
  await expect(buy).toBeFocused();

  // Buy 10 at market: price prefilled and disabled, value and cash shown, then review.
  await buy.click();
  await expect(ticket.getByRole('textbox', { name: 'Price (₹)' })).toBeDisabled();
  await expect(ticket.getByRole('textbox', { name: 'Price (₹)' })).toHaveValue(/^\d+\.\d{2}$/);
  await expect(ticket.getByTestId('available-cash')).toHaveText('₹10,00,000.00');
  await qty.fill('10');
  await expect(ticket.getByTestId('order-value')).toHaveText(/^₹[\d,]+\.\d{2}$/);
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await expect(ticket.getByRole('heading', { name: 'Review your order' })).toBeFocused();
  await ticket.getByRole('button', { name: 'Confirm' }).click();

  // Success: the ticket closes and the toast links to the order book.
  await expect(ticket).toBeHidden();
  const toast = page.getByRole('status').filter({ hasText: 'Order executed' });
  await expect(toast.first()).toContainText(/BUY 10 INFY @ ₹[\d,]+\.\d{2}/);
  await page.getByRole('link', { name: 'View orders' }).click();
  await expect(page).toHaveURL(/\/orders$/);
});

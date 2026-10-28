import { expect, test, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';

// CR-T18 (SPEC-CR-1 §7): the instrument page's offline state on a phone. The browser going
// offline marks the last price and the indices stale, pauses the chart over its last candles,
// locks the order lines and disables the ticket's button with the reason; back online, all of it
// clears. The clock is fixed at Monday 28 Sep 2026, 10:00 IST so NSE is open.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

const tradeBar = (page: Page) => page.getByRole('group', { name: 'Trade INFY' });

test('offline on a phone: stale price and indices, a paused chart, locked lines, no orders (CR-T18)', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);

  // A resting limit order, so the chart has a line to lock.
  await tradeBar(page).getByRole('button', { name: 'Buy INFY' }).click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await ticket.getByRole('radio', { name: 'Limit' }).click();
  const price = ticket.getByRole('textbox', { name: 'Price (₹)' });
  await expect(price).toHaveValue(/^\d+\.\d{2}$/);
  const limit = Math.round(Number(await price.inputValue()) * 0.99 * 20) / 20;
  await price.fill(limit.toFixed(2));
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();
  const line = page.locator('[data-testid="chart-handle"][data-tone="buy"]');
  await expect(line).toBeVisible();
  await expect(page.getByTestId('chart-tab-grip')).toHaveCount(1);

  await context.setOffline(true);
  await expect(page.getByTestId('price-stale')).toHaveText(/^Stale · as of \d{2}:\d{2}/);
  await expect(page.getByTestId('tickers-stale').first()).toHaveText('Stale');
  await expect(page.getByTestId('chart-paused')).toHaveText('Paused: offline');
  await expect(page.getByTestId('chart-tab-lock')).toHaveCount(1);
  await expect(page.getByTestId('chart-tab-grip')).toHaveCount(0);
  await expect(line).toHaveAccessibleDescription(/Locked while offline/);

  await tradeBar(page).getByRole('button', { name: 'Buy INFY' }).click();
  await expect(ticket.getByText("You're offline. Orders resume when you reconnect.")).toBeVisible();
  await expect(ticket.getByRole('button', { name: 'Buy INFY' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(ticket).toBeHidden();

  await context.setOffline(false);
  await expect(page.getByTestId('price-stale')).toHaveCount(0);
  await expect(page.getByTestId('chart-paused')).toHaveCount(0);
  await expect(page.getByTestId('chart-tab-grip')).toHaveCount(1);
});

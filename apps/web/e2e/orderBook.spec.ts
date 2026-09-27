import { expect, test, type Page } from '@playwright/test';

// T-144 to T-146: the order book journey in msw mode. Place a limit order well below the market,
// see it under Open, modify its price in the ticket, cancel it after the confirm, and find it
// under Cancelled with its status timeline.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so the in-browser paper engine sees
// NSE open whatever day the suite runs on.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

async function logIn(page: Page) {
  await page.getByRole('textbox', { name: 'Mobile number' }).fill('9876512345');
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await page.getByRole('group', { name: 'One-time password' }).getByRole('textbox').first().click();
  await page.keyboard.type('123456');
  await page.getByRole('button', { name: 'Skip for now' }).click();
}

/** Rupees as the price input shows them, on the 5-paise tick. */
const rupees = (paise: number) => ((Math.round(paise / 5) * 5) / 100).toFixed(2);
const inr = (paise: number) =>
  `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format((Math.round(paise / 5) * 5) / 100)}`;

test('place a limit order, see it Open, modify it, cancel it, find it under Cancelled', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/stocks/INFY');
  await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();

  await page.getByRole('button', { name: 'Buy INFY' }).click();
  await logIn(page);
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();
  const price = ticket.getByRole('textbox', { name: 'Price (₹)' });
  await expect(price).toHaveValue(/^\d+\.\d{2}$/);
  const ltp = Math.round(Number(await price.inputValue()) * 100);

  // A limit buy 5% under the market rests OPEN (the band is ±20%).
  const limit = ltp * 0.95;
  await ticket.getByRole('radio', { name: 'Limit' }).click();
  await price.fill(rupees(limit));
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('5');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Order placed' }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Orders', exact: true }).first().click();
  await expect(page).toHaveURL(/\/orders/);
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Open (1)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const openTable = page.getByRole('table', { name: 'Open orders' });
  await expect(openTable.getByRole('row').nth(1)).toContainText(inr(limit));
  await expect(openTable.getByRole('row').nth(1)).toContainText('0 / 5');

  // Modify: only quantity and price can change.
  await page.getByRole('button', { name: 'Modify BUY 5 INFY order' }).click();
  const modify = page.getByRole('dialog', { name: 'Modify INFY order' });
  await expect(modify).toBeVisible();
  await expect(modify.getByRole('radio', { name: 'Sell' })).toBeDisabled();
  const lower = ltp * 0.94;
  await modify.getByRole('textbox', { name: 'Price (₹)' }).fill(rupees(lower));
  await modify.getByRole('button', { name: 'Review changes' }).click();
  await modify.getByRole('button', { name: 'Modify order' }).click();
  await expect(modify).toBeHidden();
  await expect(openTable.getByRole('row').nth(1)).toContainText(inr(lower));

  // Cancel after the confirm: the order moves to the Cancelled tab.
  await page.getByRole('button', { name: 'Cancel BUY 5 INFY order' }).click();
  const confirm = page.getByRole('dialog', { name: 'Cancel this order?' });
  await confirm.getByRole('button', { name: 'Cancel order' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Open (0)' })).toBeVisible();
  await page.getByRole('tab', { name: 'Cancelled (1)' }).click();
  await expect(page).toHaveURL(/tab=cancelled/);
  const cancelled = page.getByRole('table', { name: 'Cancelled orders' });
  await expect(cancelled.getByRole('row').nth(1)).toContainText('Cancelled');

  // The detail drawer shows every step with its IST time.
  await page.getByRole('button', { name: 'Details of BUY 5 INFY order' }).click();
  const drawer = page.getByRole('dialog', { name: 'INFY order' });
  const steps = drawer.getByRole('list', { name: 'Status timeline' }).getByRole('listitem');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText('Placed');
  await expect(steps.nth(1)).toContainText('Modified');
  await expect(steps.nth(2)).toContainText('Cancelled');
  await expect(steps.nth(2)).toContainText(/10:00:\d{2} (am|AM) IST/);
});

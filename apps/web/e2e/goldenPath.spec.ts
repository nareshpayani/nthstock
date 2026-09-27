import { PAPER_OPENING_BALANCE_PAISE } from '@nthstock/contracts';
import { expect, test, type Page } from '@playwright/test';
import { logIn } from './support/auth';
import { API_TAG } from './support/env';
import { inr, MONDAY_10_00_IST, MONDAY_15_35_IST, setClock } from './support/testControls';

// T-163 (msw mode) and T-164 (api mode, tagged @api): the golden path. Log in, add INFY to a
// watchlist, open its stock detail, buy 10 at market for delivery, and find the order Executed in
// the order book, INFY in positions and (after the close) in holdings, and the cash debited.
//
// Every clock sits on Monday 28 Sep 2026 (setClock): 10:00 IST, market open, for the buy; 15:35 IST
// for holdings, since delivery buys move there at the close.

const nav = (page: Page, name: string) =>
  page.getByRole('link', { name, exact: true }).first().click();

/** "₹1,234.50" → 123450 paise. */
const paiseOf = (text: string) => Math.round(Number(text.replace(/[₹,]/g, '')) * 100);

test(`golden path: watch INFY, buy 10 at market, see it executed, held and paid for ${API_TAG}`, async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setClock(page, MONDAY_10_00_IST);
  await page.goto('/login?redirect=%2Fdashboard');
  await logIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);

  // Add INFY to the watchlist from search.
  const rail = page.getByRole('complementary', { name: 'Watchlist and search' });
  await expect(rail.getByRole('tab', { name: 'My Watchlist' })).toBeVisible();
  await rail.getByRole('combobox', { name: 'Search stocks' }).fill('infy');
  await expect(rail.getByRole('option').first()).toContainText('INFY');
  await rail.locator('[data-add-to-watchlist="INFY"]').click();
  await expect(rail.getByRole('option').first()).toContainText('In My Watchlist');
  await page.keyboard.press('Escape');
  const row = rail
    .getByRole('list', { name: 'Stocks in My Watchlist' })
    .getByRole('link', { name: /^INFY NSE/ });
  await expect(row).toBeVisible();

  // Stock detail from the watchlist row.
  await row.click();
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();

  // Buy 10 at market for delivery (the ticket's defaults), review and confirm.
  await page.getByRole('main').getByRole('button', { name: 'Buy INFY' }).click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();
  await expect(ticket.getByRole('radio', { name: 'Delivery' })).toBeChecked();
  await expect(ticket.getByRole('radio', { name: 'Market' })).toBeChecked();
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('10');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();
  const toast = page.getByRole('status').filter({ hasText: 'Order executed' }).first();
  await expect(toast).toContainText(/BUY 10 INFY @ ₹[\d,]+\.\d{2}/);
  const fill = /@ (₹[\d,]+\.\d{2})/.exec((await toast.textContent()) ?? '')?.[1];
  if (!fill) throw new Error('no fill price in the toast');
  const cost = 10 * paiseOf(fill);

  // The order book: Executed, 10 of 10 at the fill price.
  await nav(page, 'Orders');
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
  await page.getByRole('tab', { name: 'Executed (1)' }).click();
  const executed = page.getByRole('table', { name: 'Executed orders' }).getByRole('row').nth(1);
  await expect(executed).toContainText('INFY');
  await expect(executed).toContainText('Executed');
  await expect(executed).toContainText('10 / 10');
  await expect(executed).toContainText(fill);

  // Positions: today's INFY position.
  await nav(page, 'Positions');
  await expect(page.getByRole('heading', { level: 1, name: 'Positions' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Positions' })).toContainText('INFY');

  // After the close the delivery buy is a holding.
  await setClock(page, MONDAY_15_35_IST);
  await nav(page, 'Portfolio');
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Holdings' })).toContainText('INFY');

  // Funds: the cost is debited from the ₹10,00,000 opening balance and shows in the ledger.
  await nav(page, 'Funds');
  await expect(page.getByRole('heading', { level: 1, name: 'Funds' })).toBeVisible();
  const available = page
    .getByRole('region', { name: 'Funds summary' })
    .getByText('Available cash', { exact: true })
    .locator('xpath=following-sibling::dd[1]');
  await expect(available).toHaveText(inr(PAPER_OPENING_BALANCE_PAISE - cost));
  await expect(page.getByRole('grid', { name: 'Funds ledger' })).toContainText('Buy');
});

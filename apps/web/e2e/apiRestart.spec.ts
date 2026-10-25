import { expect, test, type Page } from '@playwright/test';
import { logIn } from './support/auth';
import { API_TAG, E2E_MODE } from './support/env';
import { MONDAY_10_00_IST, MONDAY_15_35_IST, restartApi, setClock } from './support/testControls';

// T-241 (NSTOCK-0241, api mode only): apps/api restarts mid-test and nothing the user did is lost.
// Log in, add INFY to a watchlist, buy 10 at market for delivery and see it executed and (after the
// close) held; then restart apps/api and load the app again: still logged in, INFY still in the
// watchlist, the order still in the order book and INFY still in holdings. Postgres is the record
// (spec backend-core §5.3) and the restarted process signs with the same JWT secret.
//
// msw mode has no apps/api to restart; mockWorkerRestart.spec.ts covers the mock's own restart.

const nav = (page: Page, name: string) =>
  page.getByRole('link', { name, exact: true }).first().click();

const watchlistRow = (page: Page) =>
  page
    .getByRole('complementary', { name: 'Watchlist and search' })
    .getByRole('list', { name: 'Stocks in My Watchlist' })
    .getByRole('link', { name: /^INFY NSE/ });

test(`apps/api restarts mid-test and the session, watchlist, order and holding survive ${API_TAG}`, async ({
  page,
}) => {
  test.skip(E2E_MODE !== 'api', 'restarts apps/api, which only api mode runs');
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setClock(page, MONDAY_10_00_IST);
  await page.goto('/login?redirect=%2Fdashboard');
  await logIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);

  // Add INFY to the watchlist from search.
  const rail = page.getByRole('complementary', { name: 'Watchlist and search' });
  await rail.getByRole('combobox', { name: 'Search stocks' }).fill('infy');
  await expect(rail.getByRole('option').first()).toContainText('INFY');
  await rail.locator('[data-add-to-watchlist="INFY"]').click();
  await expect(rail.getByRole('option').first()).toContainText('In My Watchlist');
  await page.keyboard.press('Escape');
  await expect(watchlistRow(page)).toBeVisible();

  // Buy 10 at market for delivery and wait for the fill.
  await watchlistRow(page).click();
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  await page.getByRole('main').getByRole('button', { name: 'Buy INFY' }).click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('10');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Order executed' }).first(),
  ).toContainText('BUY 10 INFY');

  // After the close the delivery buy is a holding.
  await setClock(page, MONDAY_15_35_IST);
  await nav(page, 'Portfolio');
  await expect(page.getByRole('table', { name: 'Holdings' })).toContainText('INFY');

  // Restart apps/api with nothing in flight from the page, so no request lands on the restarted
  // process before its test clock is back on Monday 15:35 IST (the clock lives in memory).
  await page.goto('about:blank');
  await restartApi(page);
  await setClock(page, MONDAY_15_35_IST);

  // Load the app again: the refresh cookie still opens a session, on the page that was open.
  await page.goto('/portfolio');
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  await expect(page.getByRole('button', { name: /account: /i })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Holdings' })).toContainText('INFY');
  await expect(watchlistRow(page)).toBeVisible();

  await nav(page, 'Orders');
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
  await page.getByRole('tab', { name: 'Executed (1)' }).click();
  const executed = page.getByRole('table', { name: 'Executed orders' }).getByRole('row').nth(1);
  await expect(executed).toContainText('INFY');
  await expect(executed).toContainText('Executed');
  await expect(executed).toContainText('10 / 10');
});

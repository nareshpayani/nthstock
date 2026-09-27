import { TICK_SIZE_PAISE } from '@nthstock/contracts';
import { expect, test, type Page } from '@playwright/test';
import { logIn } from './support/auth';
import { API_TAG } from './support/env';
import {
  inr,
  MONDAY_10_00_IST,
  MONDAY_20_00_IST,
  rupees,
  scriptedPrices,
  setClock,
  setPrice,
  TUESDAY_09_15_IST,
} from './support/testControls';

// T-165: a limit order filled by a scripted price cross, and an AMO released at 9:15 IST, in msw
// mode and (tagged @api) against apps/api and apps/realtime. Prices and time come from the test
// controls (T-162), never from the random walk or the wall clock. The fills reach the order book
// live, over the WebSocket order updates, without a reload.

async function openTicket(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/stocks/INFY');
  await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();
  const prices = await scriptedPrices(page, 'INFY');
  await setPrice(page, 'INFY', prices.base);
  await page.getByRole('button', { name: 'Buy INFY' }).click();
  await logIn(page);
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();
  return { ticket, ...prices };
}

async function openOrders(page: Page) {
  await page.getByRole('link', { name: 'Orders', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
}

test(`a limit buy rests Open and fills when a scripted price crosses it ${API_TAG}`, async ({
  page,
}) => {
  test.setTimeout(150_000);
  await setClock(page, MONDAY_10_00_IST);
  const { ticket, below } = await openTicket(page);

  await ticket.getByRole('radio', { name: 'Limit' }).click();
  await ticket.getByRole('textbox', { name: 'Price (₹)' }).fill(rupees(below));
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('3');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Order placed' }).first()).toBeVisible();

  await openOrders(page);
  await expect(page.getByRole('tab', { name: 'Open (1)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const open = page.getByRole('table', { name: 'Open orders' }).getByRole('row').nth(1);
  await expect(open).toContainText(inr(below));
  await expect(open).toContainText('0 / 3');

  // One tick under the limit: the order fills at its limit and the book updates live.
  await setPrice(page, 'INFY', below - TICK_SIZE_PAISE);
  await expect(page.getByRole('tab', { name: 'Open (0)' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Executed (1)' }).click();
  const filled = page.getByRole('table', { name: 'Executed orders' }).getByRole('row').nth(1);
  await expect(filled).toContainText('Executed');
  await expect(filled).toContainText('3 / 3');
  await expect(filled).toContainText(inr(below));
});

test(`an evening market buy waits as AMO and executes at 9:15 IST next day ${API_TAG}`, async ({
  page,
}) => {
  test.setTimeout(150_000);
  await setClock(page, MONDAY_20_00_IST);
  const { ticket, base } = await openTicket(page);

  // The market is closed: the order goes in as an AMO. (msw mode forces the mock market open for
  // live prices, so its ticket keeps the Buy wording; the order still becomes an AMO.)
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('2');
  await ticket.getByRole('button', { name: /^(Buy INFY|Place AMO)$/ }).click();
  await ticket.getByRole('button', { name: /^Confirm( AMO)?$/ }).click();
  await expect(ticket).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'AMO placed' }).first()).toBeVisible();

  await openOrders(page);
  const open = page.getByRole('table', { name: 'Open orders' }).getByRole('row').nth(1);
  await expect(open).toContainText('AMO');
  await expect(open).toContainText('0 / 2');

  // Overnight to 9:15 IST: the AMO is released and fills at the market price, live.
  await setClock(page, TUESDAY_09_15_IST);
  await expect(page.getByRole('tab', { name: 'Open (0)' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Executed (1)' }).click();
  const filled = page.getByRole('table', { name: 'Executed orders' }).getByRole('row').nth(1);
  await expect(filled).toContainText('Executed');
  await expect(filled).toContainText('2 / 2');
  await expect(filled).toContainText(inr(base));
});

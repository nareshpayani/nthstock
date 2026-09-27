import { expect, test, type Page } from '@playwright/test';

// T-160, T-161: the reset paper balance journey in msw mode. Buy INFY, see the cash debited on
// Funds, reset the paper balance after typing RESET, and find ₹10,00,000.00 in Funds and nothing
// left in Orders, Positions and Portfolio.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so the in-browser paper engine sees
// NSE open whatever day the suite runs on.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

async function logIn(page: Page) {
  await page.getByRole('textbox', { name: 'Mobile number' }).fill('9876512399');
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await page.getByRole('group', { name: 'One-time password' }).getByRole('textbox').first().click();
  await page.keyboard.type('123456');
  await page.getByRole('button', { name: 'Skip for now' }).click();
}

const figure = (page: Page, label: string) =>
  page
    .getByRole('region', { name: 'Funds summary' })
    .getByText(label, { exact: true })
    .locator('xpath=following-sibling::dd[1]');

test('buy, reset the paper balance by typing RESET, and start again from ₹10,00,000.00', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/stocks/INFY');
  await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();

  // A market buy of 2 shares executes at once.
  await page.getByRole('button', { name: 'Buy INFY' }).click();
  await logIn(page);
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('2');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();

  await page.getByRole('link', { name: 'Positions', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Positions' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Positions' })).toContainText('INFY');
  await expect(page.getByRole('region', { name: 'Total P&L' })).toBeVisible();

  await page.getByRole('link', { name: 'Funds', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Funds' })).toBeVisible();
  await expect(figure(page, 'Available cash')).not.toHaveText('₹10,00,000.00');
  await expect(page.getByText('Opening balance ₹10,00,000.00')).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Funds ledger' })).toContainText('Buy');

  // The danger dialog explains what is cleared and needs RESET typed exactly.
  await page.getByRole('button', { name: 'Reset paper balance' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset your paper balance?' });
  await expect(dialog).toContainText('All positions and holdings are cleared');
  const confirm = dialog.getByRole('button', { name: 'Reset balance' });
  await expect(confirm).toBeDisabled();
  const field = dialog.getByRole('textbox', { name: 'Type RESET to confirm' });
  await field.fill('reset');
  await expect(confirm).toBeDisabled();
  await field.fill('RESET');
  await confirm.click();
  await expect(dialog).toBeHidden();

  await expect(
    page.getByRole('status').filter({ hasText: 'Paper balance reset' }).first(),
  ).toBeVisible();
  await expect(figure(page, 'Available cash')).toHaveText('₹10,00,000.00');
  await expect(figure(page, 'Total')).toHaveText('₹10,00,000.00');
  await expect(figure(page, 'Invested')).toHaveText('₹0.00');
  await expect(
    page.getByRole('grid', { name: 'Funds ledger' }).getByRole('row').nth(1),
  ).toContainText('Reset');

  // Orders, positions and holdings are empty.
  await page.getByRole('link', { name: 'Orders', exact: true }).first().click();
  await expect(page.getByRole('tab', { name: 'Open (0)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Executed (0)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Cancelled (0)' })).toBeVisible();
  await page.getByRole('link', { name: 'Positions', exact: true }).first().click();
  await expect(page.getByText('No positions today')).toBeVisible();
  await page.getByRole('link', { name: 'Portfolio', exact: true }).first().click();
  await expect(page.getByText('Your portfolio is empty')).toBeVisible();

  // A reload keeps the reset (the in-browser engine saved it).
  await page.getByRole('link', { name: 'Funds', exact: true }).first().click();
  await page.reload();
  await expect(figure(page, 'Available cash')).toHaveText('₹10,00,000.00');
});

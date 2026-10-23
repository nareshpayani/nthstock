import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';

// T24 (SPEC-TFC-1 §13, REQ-MOB-07): every chart action with the keyboard alone. Place a limit buy
// from the ticket, move its line with the arrow keys and Enter, cancel it with Delete, then buy at
// market and set a trailing stop from the position chip. The mouse is never used: elements get
// focus through `focus()` and the keyboard, and axe checks the chart, the ticket and the sheet.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so NSE is open for the paper engine.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

const rupees = (text: string) => {
  const match = /₹([\d,]+\.\d\d)/.exec(text);
  if (!match?.[1]) throw new Error(`no price in "${text}"`);
  return Number(match[1].replaceAll(',', ''));
};

/** Focuses `target` and presses `key` on it, as Tab and a key press would. */
async function press(target: Locator, key: string) {
  await target.focus();
  await expect(target).toBeFocused();
  await target.page().keyboard.press(key);
}

async function typeInto(field: Locator, text: string) {
  await field.focus();
  await field.page().keyboard.press('ControlOrMeta+A');
  await field.page().keyboard.type(text);
}

async function openTicket(page: Page) {
  await press(page.getByRole('button', { name: 'Buy INFY' }).first(), 'Enter');
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();
  return ticket;
}

async function confirm(page: Page, ticket: Locator) {
  await press(ticket.getByRole('button', { name: 'Buy INFY' }), 'Enter');
  await press(ticket.getByRole('button', { name: 'Confirm' }), 'Enter');
  await expect(ticket).toBeHidden();
}

test('keyboard only: modify and cancel an order line, set a trailing stop (T24)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  const figure = page.getByRole('figure', { name: /INFY area chart/ });
  await expect(figure.getByTestId('chart-gutter')).toBeVisible();

  // A limit buy half a percent under the market, from the ticket.
  const ticket = await openTicket(page);
  await press(
    ticket.getByRole('radiogroup', { name: 'Order type' }).getByRole('radio', { name: 'Limit' }),
    'Space',
  );
  const price = ticket.getByRole('textbox', { name: 'Price (₹)' });
  await expect(price).toHaveValue(/^\d+\.\d{2}$/);
  const limit = Math.round(Number(await price.inputValue()) * 0.995 * 20) / 20;
  await typeInto(price, limit.toFixed(2));
  await typeInto(ticket.getByRole('textbox', { name: 'Quantity' }), '3');
  await expectNoSeriousA11yViolations(page, 'order ticket', '[role="dialog"]');
  await confirm(page, ticket);

  // Its line: three ticks up with the arrow keys, Enter saves.
  const line = figure.locator('[data-testid="chart-handle"][data-tone="buy"]');
  await expect(line).toContainText('Buy 3 @ ₹');
  await expect(line).toHaveAccessibleDescription(
    /arrow keys .*Enter saves, Escape restores, Delete cancels/,
  );
  const placed = rupees(await line.innerText());
  await line.focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowUp');
  await expect.poll(async () => rupees(await line.innerText())).toBeCloseTo(placed + 0.15, 2);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'Order modified' }).first(),
  ).toBeVisible();
  await expect.poll(async () => rupees(await line.innerText())).toBeCloseTo(placed + 0.15, 2);

  // Escape mid-move puts the line back without sending anything.
  await line.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Escape');
  await expect.poll(async () => rupees(await line.innerText())).toBeCloseTo(placed + 0.15, 2);

  // Delete cancels it.
  await press(line, 'Delete');
  await expect(
    page.getByRole('status').filter({ hasText: 'Order cancelled' }).first(),
  ).toBeVisible();
  await expect(line).toHaveCount(0);

  // A market buy, then a trailing stop from the position chip.
  const market = await openTicket(page);
  await typeInto(market.getByRole('textbox', { name: 'Quantity' }), '2');
  await confirm(page, market);
  const chip = figure.locator('[data-testid="chart-handle"][data-tone="position"]');
  await expect(chip).toHaveText(/\+2 @ ₹/);
  await expectNoSeriousA11yViolations(
    page,
    'chart with a position',
    '[data-testid="chart-overlay"]',
  );
  await press(chip, 'Enter');
  const sheet = page.getByRole('dialog', { name: 'Trailing stop · INFY' });
  await expect(sheet).toBeVisible();
  // The sheet takes focus inside it.
  await expect
    .poll(() => sheet.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await expectNoSeriousA11yViolations(page, 'trailing-stop sheet', '[role="dialog"]');
  await typeInto(sheet.getByRole('textbox', { name: 'Trail (%)' }), '2');
  await press(sheet.getByRole('button', { name: 'Set trailing stop' }), 'Enter');
  await expect(sheet).toBeHidden();
  const stop = figure.locator('[data-testid="chart-handle"][data-tone="trailing"]');
  await expect(stop).toHaveText(/Trailing SL ₹[\d,]+\.\d\d · 2% · Trailing$/);
  // Closing the sheet gives focus back to the chip.
  await expect(chip).toBeFocused();
});

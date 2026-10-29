import { expect, test, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';

// NSTOCK-0395: Edit beside Exit on a Positions row opens the position editor. It states the
// executed quantity and the stop, sets a trailing stop with every term, and exits part of the
// position through the full ticket, refusing more than is held. Desktop and phone.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so NSE is open for the paper engine.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;
const SHOTS = process.env['POSITION_EDITOR_SHOTS'];

async function buyAtMarket(page: Page, phone: boolean, qty: number) {
  const buy = phone
    ? page.getByRole('group', { name: 'Trade INFY' }).getByRole('button', { name: 'Buy INFY' })
    : page.getByRole('button', { name: 'Buy INFY' });
  await buy.click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill(String(qty));
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();
}

for (const viewport of VIEWPORTS) {
  test(`position editor: set a trailing stop and exit part of a position on the ${viewport.name} (NSTOCK-0395)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.clock.setFixedTime(MONDAY_10_IST);
    await page.setViewportSize(viewport);
    await page.goto('/login?redirect=%2Fstocks%2FINFY');
    await logIn(page, uniqueMobile());
    await expect(page).toHaveURL(/\/stocks\/INFY$/);
    await buyAtMarket(page, viewport.name === 'phone', 10);

    await page.goto('/positions');
    // A phone lists positions as rows of a list, not a table (NSTOCK-0447).
    const phone = viewport.name === 'phone';
    const row = phone
      ? page
          .getByRole('list', { name: 'Positions' })
          .getByRole('listitem')
          .filter({ hasText: 'INFY' })
      : page.getByRole('row', { name: /INFY/ });
    const edit = page.getByRole('button', { name: /^Edit INFY delivery position/ });
    await expect(edit).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/positions-${viewport.name}.png` });
    await edit.click();

    // The summary, then a stop with a limit exit: every term, not only the trail.
    let editor = page.getByRole('dialog', { name: 'Edit INFY · Delivery' });
    const summary = editor.getByTestId('editor-summary');
    await expect(summary).toContainText('+10');
    await expect(editor.getByTestId('editor-stop')).toHaveText('No trailing stop');
    await expect(editor.getByRole('textbox', { name: /Activation price/ })).toBeVisible();
    const exitType = editor.getByRole('radiogroup', { name: 'Exit order' });
    await exitType.getByRole('radio', { name: 'Limit' }).click();
    await editor.getByRole('textbox', { name: 'Limit offset (₹)' }).fill('0.50');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/editor-stop-${viewport.name}.png` });
    await editor.getByRole('button', { name: 'Set trailing stop' }).click();
    await expect(editor).toBeHidden();
    await expect(row).toContainText(/Trailing/);

    // Exit part: the full ticket, prefilled with what is held, never more.
    await edit.click();
    editor = page.getByRole('dialog', { name: 'Edit INFY · Delivery' });
    await expect(editor.getByTestId('editor-stop')).toContainText('protects 10 shares');
    await editor.getByRole('tab', { name: 'Exit' }).click();
    const qty = editor.getByRole('textbox', { name: 'Quantity' });
    await expect(qty).toHaveValue('10');
    await qty.fill('12');
    await editor.getByRole('button', { name: 'Sell INFY' }).click();
    await expect(editor.getByText('You hold 10. Exit up to 10')).toBeVisible();
    await qty.fill('4');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/editor-exit-${viewport.name}.png` });
    await editor.getByRole('button', { name: 'Sell INFY' }).click();
    await editor.getByRole('button', { name: 'Confirm' }).click();
    await expect(editor).toBeHidden();
    if (phone) await expect(row).toContainText('Qty 6');
    else await expect(row.getByRole('cell', { name: '6', exact: true })).toBeVisible();
  });
}

import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn } from './support/auth';
import { MONDAY_10_00_IST, setClock } from './support/testControls';

// T-167: an order placed with the keyboard alone, with a visible focus ring at every step:
// / to search, ↓ and Shift+Enter to watch INFY, Enter to open it, Tab to its watchlist row, B for
// the ticket, type the quantity, Enter to review, Tab to Confirm and Enter; then B again and Esc
// close the ticket with focus back on the row. The mouse is never used.

/**
 * The focused element shows a focus indicator: it matches :focus-visible, and it draws an outline
 * or a ring (a box-shadow with a spread, as Tailwind's ring-*), itself or on the field frame around
 * it (an ancestor up to three levels up that matches :focus-within, as inputs draw it there).
 */
async function expectVisibleFocus(page: Page, what: string) {
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const draws = (node: Element) => {
      const style = getComputedStyle(node);
      const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
      // A ring layer: "<colour> 0px 0px 0px 3px" (x, y, blur 0 and a spread of at least 1px).
      const ring = /(^|,\s*)(rgba?\([^)]*\)\s+)?0px 0px 0px [1-9]/.test(style.boxShadow);
      return outline || ring;
    };
    let frame: Element | null = element;
    let drawn = draws(element);
    for (let level = 0; !drawn && level < 3; level += 1) {
      frame = frame?.parentElement ?? null;
      if (!frame || !frame.matches(':focus-within')) break;
      drawn = draws(frame);
    }
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      element: `${element.outerHTML.slice(0, 300)} outline=${style.outline} shadow=${style.boxShadow}`,
      focusVisible: element.matches(':focus-visible'),
      drawn,
      onScreen: box.width > 0 && box.height > 0,
    };
  });
  expect(focus, `${what}: something has focus`).not.toBeNull();
  expect(focus?.focusVisible, `${what}: :focus-visible`).toBe(true);
  expect(focus?.onScreen, `${what}: the focused element is on screen`).toBe(true);
  expect(focus?.drawn, `${what}: an outline or ring is drawn on ${focus?.element ?? ''}`).toBe(
    true,
  );
}

/** Presses Tab until `target` has focus (at most `max` times), checking focus at each stop. */
async function tabTo(page: Page, target: Locator, what: string, max = 40) {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      await expectVisibleFocus(page, what);
      return;
    }
    await page.keyboard.press('Tab');
    await expectVisibleFocus(page, `${what} (tab stop ${String(i + 1)})`);
  }
  throw new Error(`${what} was not reached in ${String(max)} Tab presses`);
}

test('keyboard only: search, open, B, fill the ticket, confirm, Esc, focus always visible', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setClock(page, MONDAY_10_00_IST);
  await page.goto('/login?redirect=%2Fdashboard');
  await logIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)/ }),
  ).toBeVisible();

  // / focuses search; ↓ highlights INFY, Shift+Enter adds it to the watchlist, Enter opens it.
  const rail = page.getByRole('complementary', { name: 'Watchlist and search' });
  await page.keyboard.press('/');
  await expect(rail.getByRole('combobox', { name: 'Search stocks' })).toBeFocused();
  await expectVisibleFocus(page, 'search');
  await page.keyboard.type('infy');
  await expect(rail.getByRole('option').first()).toContainText('INFY');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+Enter');
  await expect(rail.getByRole('option').first()).toContainText('In My Watchlist');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();

  // Tab to INFY's watchlist row; B opens the ticket with Quantity focused.
  const row = rail
    .getByRole('list', { name: 'Stocks in My Watchlist' })
    .getByRole('link', { name: /^INFY NSE/ });
  await expect(row).toBeVisible();
  await tabTo(page, row, 'the INFY watchlist row');
  await page.keyboard.press('b');
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();
  const qty = ticket.getByRole('textbox', { name: 'Quantity' });
  await expect(qty).toBeFocused();
  await expect(ticket.getByRole('textbox', { name: 'Price (₹)' })).toHaveValue(/^\d+\.\d{2}$/);

  // Type 5 over the prefilled quantity, Enter reviews, Tab to Confirm, Enter places the order.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('5');
  await expect(qty).toHaveValue('5');
  await page.keyboard.press('Enter');
  await expect(ticket.getByRole('heading', { name: 'Review your order' })).toBeFocused();
  await tabTo(page, ticket.getByRole('button', { name: 'Confirm' }), 'Confirm', 10);
  await page.keyboard.press('Enter');
  await expect(ticket).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Order executed' }).first(),
  ).toContainText(/BUY 5 INFY @ ₹[\d,]+\.\d{2}/);

  // Focus is back on the row; B reopens the ticket and Esc closes it, focus back on the row.
  await expect(row).toBeFocused();
  await expectVisibleFocus(page, 'the row after the order');
  await page.keyboard.press('b');
  await expect(ticket).toBeVisible();
  await expectVisibleFocus(page, 'the reopened ticket');
  await page.keyboard.press('Escape');
  await expect(ticket).toBeHidden();
  await expect(row).toBeFocused();
  await expectVisibleFocus(page, 'the row after Esc');
});

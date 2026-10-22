import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';

// T16 (SPEC-TFC-1 §8.1, §8.3, §9.3, REQ-TFC-01, REQ-TFC-02): a working limit order is a line on
// the chart. Dragging its handle moves the price, shown on the line while dragging, and sends one
// modify on release; × asks "Cancel?" and a second tap cancels. Desktop and phone.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so NSE is open for the paper engine.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('element has no box');
  return rect;
}

const rupees = (text: string) => {
  const match = /₹([\d,]+\.\d\d)/.exec(text);
  if (!match?.[1]) throw new Error(`no price in "${text}"`);
  return Number(match[1].replaceAll(',', ''));
};

/** Places a buy limit half a percent under the market from the ticket; returns its price. */
async function placeBuyLimit(page: Page, phone: boolean): Promise<number> {
  const buy = phone
    ? page.getByRole('group', { name: 'Trade INFY' }).getByRole('button', { name: 'Buy INFY' })
    : page.getByRole('button', { name: 'Buy INFY' });
  await buy.click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await ticket
    .getByRole('radiogroup', { name: 'Order type' })
    .getByRole('radio', { name: 'Limit' })
    .click();
  const price = ticket.getByRole('textbox', { name: 'Price (₹)' });
  await expect(price).toHaveValue(/^\d+\.\d{2}$/);
  const ltp = Number(await price.inputValue());
  const limit = Math.round(ltp * 0.995 * 20) / 20;
  await price.fill(limit.toFixed(2));
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('3');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();
  return limit;
}

for (const viewport of VIEWPORTS) {
  test(`drag to modify and two-tap cancel an order line on the ${viewport.name} chart (T16)`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.clock.setFixedTime(MONDAY_10_IST);
    await page.setViewportSize(viewport);
    await page.goto('/login?redirect=%2Fstocks%2FINFY');
    await logIn(page, uniqueMobile());
    await expect(page).toHaveURL(/\/stocks\/INFY$/);
    const figure = page.getByRole('figure', { name: /INFY area chart/ });
    await expect(figure.getByTestId('chart-gutter')).toBeVisible();

    const placed = await placeBuyLimit(page, viewport.name === 'phone');
    const line = figure.locator('[data-testid="chart-handle"][data-tone="buy"]');
    await expect(line).toContainText(`Buy 3 @ ₹`);
    expect(rupees(await line.innerText())).toBe(placed);

    // Drag up: the label follows; one modify on release raises the price.
    const from = await box(line);
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 15, { steps: 3 });
    await page.mouse.move(x, y - 30, { steps: 3 });
    const dragged = rupees(await line.innerText());
    expect(dragged).toBeGreaterThan(placed);
    await page.mouse.up();
    await expect(
      page.getByRole('status').filter({ hasText: 'Order modified' }).first(),
    ).toBeVisible();
    await expect.poll(async () => rupees(await line.innerText())).toBe(dragged);

    // × once asks; a second tap cancels and the line goes.
    const cross = figure.getByTestId('chart-handle-action');
    await cross.click();
    await expect(cross).toHaveText('Cancel?');
    await cross.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Order cancelled' }).first(),
    ).toBeVisible();
    await expect(figure.getByTestId('chart-handle')).toHaveCount(0);
  });
}

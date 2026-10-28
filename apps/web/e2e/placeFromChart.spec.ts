import { expect, test, type Locator } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';

// T17 (SPEC-TFC-1 §8.2, US-01, US-02, REQ-TFC-03, REQ-TFC-05): place a limit from the chart. Tap
// the price gutter for a ghost line, drag it to the price, tap Buy, and the compact ticket opens
// as a limit at that price with "Add trailing stop" inline. Nothing is sent before Place; the
// placed order is a line at the ghost's price. Desktop and phone.
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

for (const viewport of VIEWPORTS) {
  test(`drag a ghost line and place a limit with a trailing stop on the ${viewport.name} chart (T17)`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.clock.setFixedTime(MONDAY_10_IST);
    await page.setViewportSize(viewport);
    await page.goto('/login?redirect=%2Fstocks%2FINFY');
    await logIn(page, uniqueMobile());
    await expect(page).toHaveURL(/\/stocks\/INFY$/);
    const figure = page.getByRole('figure', { name: /INFY area chart/ });
    const gutter = figure.getByTestId('chart-gutter');
    await expect(gutter).toBeVisible();

    // Low in the pane, so the buy rests on the book below the market.
    const lane = await box(gutter);
    await page.mouse.click(lane.x + lane.width / 2, lane.y + lane.height * 0.85);
    const ghost = figure.locator('[data-testid="chart-handle"][data-tone="ghost"]');
    await expect(ghost).toHaveText(/New order @ ₹/);
    const tapped = rupees(await ghost.innerText());

    // Drag the ghost up a little; its price follows.
    const from = await box(ghost);
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 10, { steps: 3 });
    await page.mouse.move(x, y - 20, { steps: 3 });
    await page.mouse.up();
    const price = rupees(await ghost.innerText());
    expect(price).toBeGreaterThan(tapped);

    // Buy: the compact ticket, a limit at the ghost's price. No order is sent yet.
    const placeRequests: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/v1\/orders$/.test(request.url())) {
        placeRequests.push(request.url());
      }
    });
    await figure.getByRole('button', { name: /^Buy at ₹.*review before placing$/ }).click();
    const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
    await expect(ticket.getByRole('textbox', { name: 'Price (₹)' })).toHaveValue(price.toFixed(2));
    await expect(ticket.getByRole('radiogroup', { name: 'Order type' })).toHaveCount(0);
    await expect(ghost).toHaveCount(0);
    await expect(ticket.getByTestId('fills-immediately')).toHaveCount(0);

    // Add trailing stop inline, a 1% trail, then Place and confirm.
    // On a phone the attached stop is behind "More options" (CR-T11).
    const more = ticket.getByRole('button', { name: /^More options/ });
    if (await more.isVisible()) await more.click();
    await ticket.getByRole('switch', { name: 'Add trailing stop' }).click();
    await ticket.getByRole('textbox', { name: 'Trail (%)' }).fill('1');
    await ticket.getByRole('textbox', { name: 'Quantity' }).fill('2');
    expect(placeRequests).toEqual([]);
    await ticket.getByRole('button', { name: 'Buy INFY' }).click();
    await expect(ticket.getByText('Trailing stop', { exact: true })).toBeVisible();
    await ticket.getByRole('button', { name: 'Confirm' }).click();
    await expect(ticket).toBeHidden();

    const line = figure.locator('[data-testid="chart-handle"][data-tone="buy"]');
    await expect(line).toContainText('Buy 2 @ ₹');
    expect(rupees(await line.innerText())).toBe(price);
  });
}

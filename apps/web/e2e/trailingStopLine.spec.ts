import { DEMO_SEED_USER } from '@nthstock/paperEngine';
import { expect, test, type Locator } from '@playwright/test';
import { logIn } from './support/auth';

// T19 (SPEC-TFC-1 §6.3, §6.5, §8.1, US-04, REQ-TFC-06, REQ-TFC-07, REQ-TSLO-09): the trailing
// stop's line on the chart. With the demo Simulator, the line rises on a rally and holds on a
// pullback and carries on after the tab goes to the background (REQ-TSLO-10); dragging it moves
// the stop and changes the trail. The Simulator is on the desktop stock page, so this runs at
// 1440 px.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so NSE is open for the paper engine.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

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

test('the trailing-stop line ratchets with the Simulator and a drag changes the trail (T19)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login?demo=1&redirect=%2Fstocks%2FINFY');
  await logIn(page, DEMO_SEED_USER.mobile);
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  const figure = page.getByRole('figure', { name: /INFY area chart/ });
  await expect(figure.getByTestId('chart-gutter')).toBeVisible();
  const simulator = page.getByRole('region', { name: 'Demo simulator' });
  await expect(simulator).toBeVisible();

  // Buy, then set a 2% trailing stop from the position chip.
  await page.getByRole('button', { name: 'Buy INFY' }).click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('5');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();
  const chip = figure.locator('[data-testid="chart-handle"][data-tone="position"]');
  await chip.click();
  const sheet = page.getByRole('dialog', { name: 'Trailing stop · INFY' });
  await sheet.getByRole('textbox', { name: 'Trail (%)' }).fill('2');
  await sheet.getByRole('button', { name: 'Set trailing stop' }).click();
  await expect(sheet).toBeHidden();
  const line = figure.locator('[data-testid="chart-handle"][data-tone="trailing"]');
  await expect(line).toHaveText(/Trailing stop ₹[\d,]+\.\d\d · 2% · Trailing$/);
  const placed = rupees(await line.innerText());

  // A rally raises the stop.
  await simulator.getByRole('button', { name: 'Rally +1%' }).click();
  await expect.poll(async () => rupees(await line.innerText())).toBeGreaterThan(placed);
  const raised = rupees(await line.innerText());

  // A pullback never lowers it.
  await simulator.getByRole('button', { name: 'Pull back −1%' }).click();
  await page.waitForTimeout(1_500);
  expect(rupees(await line.innerText())).toBeGreaterThanOrEqual(raised);
  const held = rupees(await line.innerText());

  // Backgrounded and resumed (§6.7, REQ-TSLO-10): the tab hides, two minutes pass, the tab comes
  // back and re-reads the account. The stop carries on from its watermark rather than reset.
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((next) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await setVisibility('hidden');
  await page.clock.setFixedTime(new Date(MONDAY_10_IST.getTime() + 2 * 60_000));
  await page.waitForTimeout(1_000);
  await setVisibility('visible');
  await page.waitForTimeout(1_500);
  await expect(line).toHaveText(/Trailing stop ₹[\d,]+\.\d\d · 2% · Trailing$/);
  expect(rupees(await line.innerText())).toBeGreaterThanOrEqual(held);

  // Drag the stop down: one modify, and the trail is now the distance in rupees.
  const at = await box(line);
  const x = at.x + at.width / 2;
  const y = at.y + at.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 3 });
  await page.mouse.move(x, y + 25, { steps: 3 });
  const dragged = rupees(await line.innerText());
  expect(dragged).toBeLessThan(held);
  await page.mouse.up();
  await expect(
    page.getByRole('status').filter({ hasText: 'Trailing stop updated' }).first(),
  ).toBeVisible();
  await expect(line).toHaveText(/Trailing stop ₹[\d,]+\.\d\d · ₹[\d,]+\.\d\d · Trailing$/);
  expect(rupees(await line.innerText())).toBeGreaterThanOrEqual(dragged);
});

import { expect, test } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';
import { setPrice } from './support/testControls';

// T21 (SPEC-TFC-1 §11, REQ-SCP-01, REQ-SCP-02, REQ-SCP-04): the scalper pad on a 390 px phone.
// The Scalp switch swaps Sell and Buy for the pad. Disarmed, nothing sends; armed, Buy at ask and
// Sell at bid fill at once as IOC orders. Each tap shows an acknowledgement and a toast, and the
// position strip shows the position and its live P&L.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so the in-browser paper engine sees
// NSE open.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

const paiseIn = (text: string) => {
  const match = /₹([\d,]+\.\d\d)/.exec(text);
  if (!match?.[1]) throw new Error(`no price in "${text}"`);
  return Math.round(Number(match[1].replaceAll(',', '')) * 100);
};
const onTick = (paise: number) => Math.round(paise / 5) * 5;

test('scalp INFY from the pad at 390 px: arm, buy at ask, sell at bid (T21)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);

  const orders: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/v1\/orders$/.test(request.url())) {
      orders.push(request.postData() ?? '');
    }
  });

  await page.getByRole('switch', { name: 'Scalp' }).click();
  const pad = page.getByRole('region', { name: 'Scalper for INFY' });
  await expect(pad).toBeVisible();
  // The pad replaces Sell and Buy; the chart stays on screen.
  await expect(page.getByRole('group', { name: 'Trade INFY' })).toHaveCount(0);
  await expect(page.getByRole('figure', { name: /INFY area chart/ })).toBeVisible();

  // Disarmed: "Arm to trade", and a tap sends nothing.
  const buy = pad.getByTestId('scalp-buy');
  const sell = pad.getByTestId('scalp-sell');
  await expect(buy).toContainText('Arm to trade');
  await expect(buy).toHaveAttribute('aria-disabled', 'true');
  // Playwright waits for an aria-disabled button to enable; a person can still tap it.
  await buy.click({ force: true });
  await page.waitForTimeout(300);
  expect(orders).toEqual([]);

  // Armed, 5 shares: Buy at ask fills at once.
  await pad.getByRole('radio', { name: '5 shares', exact: true }).click();
  await pad.getByRole('switch', { name: 'Arm' }).click();
  await expect(buy).toContainText(/Buy at ask\s*₹[\d,]+\.\d\d/);
  await expectNoSeriousA11yViolations(page, 'scalper pad, armed', '[data-testid="scalper-pad"]');
  // The engine's price is pinned a little under the ask shown, so the IOC buy is marketable even
  // if the live price ticks between the frame and the tap (it fills at the better price).
  await setPrice(page, 'INFY', onTick(paiseIn(await buy.innerText()) * 0.97));
  await buy.click();
  const ack = pad.getByRole('status', { name: 'Last scalp order' });
  await expect(ack).toHaveText(/^Bought 5 @ ₹[\d,]+\.\d\d$/);
  // One toast per fill, from whichever hears of it first: the pad's answer or the order stream.
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /Scalp filled|Order executed/ })
      .first(),
  ).toBeVisible();
  const strip = page.getByTestId('position-strip');
  await expect(strip).toContainText(/\+5\s*@ ₹[\d,]+\.\d{2}/);
  await expect(strip).toContainText(/₹[\d,]+\.\d\d/);
  expect(orders).toHaveLength(1);
  expect(JSON.parse(orders[0] ?? '{}')).toMatchObject({
    side: 'BUY',
    type: 'LIMIT',
    product: 'INTRADAY',
    qty: 5,
    validity: 'IOC',
  });

  // Sell at bid closes it; the engine's price is pinned a little over the bid shown.
  await setPrice(page, 'INFY', onTick(paiseIn(await sell.innerText()) * 1.03));
  await sell.click();
  await expect(ack).toHaveText(/^Sold 5 @ ₹[\d,]+\.\d\d$/);
  await expect(strip).toHaveCount(0);
  expect(orders).toHaveLength(2);

  // The size stays chosen after a reload.
  await page.reload();
  await page.getByRole('switch', { name: 'Scalp' }).click();
  await expect(pad.getByRole('radio', { name: '5 shares', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

// T22 (SPEC-TFC-1 §11.2, §11.3, REQ-SCP-03, REQ-SCP-05): Flatten in one tap; Reverse only after a
// 400 ms hold, which closes the position and opens the same size the other way.
test('flatten and reverse from the pad at 390 px (T22)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);

  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/v1\/(orders|positions\/close)$/.test(request.url())) {
      sent.push(new URL(request.url()).pathname);
    }
  });

  await page.getByRole('switch', { name: 'Scalp' }).click();
  const pad = page.getByRole('region', { name: 'Scalper for INFY' });
  const buy = pad.getByTestId('scalp-buy');
  const flatten = pad.getByTestId('scalp-flatten');
  const reverse = pad.getByTestId('scalp-reverse');
  const ack = pad.getByRole('status', { name: 'Last scalp order' });
  const strip = page.getByTestId('position-strip');
  await pad.getByRole('radio', { name: '5 shares', exact: true }).click();
  await pad.getByRole('switch', { name: 'Arm' }).click();
  await expect(flatten).toContainText('No position');

  const buyFive = async () => {
    await expect(buy).toContainText(/Buy at ask\s*₹[\d,]+\.\d\d/);
    await setPrice(page, 'INFY', onTick(paiseIn(await buy.innerText()) * 0.97));
    await buy.click();
    await expect(ack).toHaveText(/^Bought 5 @ ₹/);
    await expect(strip).toContainText(/\+5\s*@ ₹/);
  };

  // Flatten: one tap closes it.
  await buyFive();
  await expect(flatten).toContainText('Sell 5');
  await flatten.click();
  await expect(ack).toHaveText(/^Closed: sold 5 @ ₹/);
  await expect(strip).toHaveCount(0);
  expect(sent).toEqual(['/v1/orders', '/v1/positions/close']);

  // Reverse: a tap sends nothing; holding it closes the long and opens a short of 5.
  await buyFive();
  await expect(reverse).toContainText('Hold to reverse');
  await reverse.click();
  await page.waitForTimeout(600);
  expect(sent).toHaveLength(3);
  const sell = pad.getByTestId('scalp-sell');
  await setPrice(page, 'INFY', onTick(paiseIn(await sell.innerText()) * 1.03));
  await reverse.hover();
  await page.mouse.down();
  await expect(ack).toHaveText(/^Reversed: Sold 5 @ ₹/);
  await page.mouse.up();
  await expect(strip).toContainText(/[−-]5\s*@ ₹/);
  expect(sent.slice(3)).toEqual(['/v1/positions/close', '/v1/orders']);
  await expectNoSeriousA11yViolations(
    page,
    'scalper pad with a position',
    '[data-testid="scalper-pad"]',
  );
});

// T23 (US-05, SPEC-TFC-1 §11.2, REQ-SCP-06): the pad stays free of trailing stops; tapping the
// scalp position opens the same trailing-stop sheet as the chart, and Flatten cancels the stop.
test('scalp, set a trailing stop from the position strip, flatten: the stop goes too (T23, US-05)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);

  await page.getByRole('switch', { name: 'Scalp' }).click();
  const pad = page.getByRole('region', { name: 'Scalper for INFY' });
  const buy = pad.getByTestId('scalp-buy');
  const ack = pad.getByRole('status', { name: 'Last scalp order' });
  await expect(pad.getByRole('button', { name: /trailing/i })).toHaveCount(0);
  await pad.getByRole('radio', { name: '5 shares', exact: true }).click();
  await pad.getByRole('switch', { name: 'Arm' }).click();
  await expect(buy).toContainText(/Buy at ask\s*₹[\d,]+\.\d\d/);
  await setPrice(page, 'INFY', onTick(paiseIn(await buy.innerText()) * 0.97));
  await buy.click();
  await expect(ack).toHaveText(/^Bought 5 @ ₹/);

  const strip = page.getByTestId('position-strip');
  await strip.getByRole('button', { name: /^\+5\s*@ ₹/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Trailing stop · INFY' });
  await sheet.getByRole('textbox', { name: 'Trail (%)' }).fill('2');
  await sheet.getByRole('button', { name: 'Set trailing stop' }).click();
  await expect(sheet).toBeHidden();
  await expect(strip).toContainText(/Trailing SL ₹[\d,]+\.\d\d/);
  const figure = page.getByRole('figure', { name: /INFY area chart/ });
  const line = figure.locator('[data-testid="chart-handle"][data-tone="trailing"]');
  await expect(line).toHaveCount(1);

  // The scalper stays armed while the sheet was open, so Flatten is one tap.
  await pad.getByTestId('scalp-flatten').click();
  await expect(ack).toHaveText(/^Closed: sold 5 @ ₹/);
  await expect(strip).toHaveCount(0);
  await expect(line).toHaveCount(0);
});

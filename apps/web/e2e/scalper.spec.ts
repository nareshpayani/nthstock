import { expect, test } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';

// T21 (SPEC-TFC-1 §11, REQ-SCP-01, REQ-SCP-02, REQ-SCP-04): the scalper pad on a 390 px phone.
// The Scalp switch swaps Sell and Buy for the pad. Disarmed, nothing sends; armed, Buy at ask and
// Sell at bid fill at once as IOC orders. Each tap shows an acknowledgement and a toast, and the
// position strip shows the position and its live P&L.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so the in-browser paper engine sees
// NSE open.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

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
  await buy.click();
  const ack = pad.getByRole('status', { name: 'Last scalp order' });
  await expect(ack).toHaveText(/^Bought 5 @ ₹[\d,]+\.\d\d$/);
  await expect(page.getByRole('status').filter({ hasText: 'Scalp filled' }).first()).toBeVisible();
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

  // Sell at bid closes it.
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

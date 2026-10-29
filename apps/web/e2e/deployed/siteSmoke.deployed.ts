import { expect, test } from '@playwright/test';
import { logIn } from '../support/auth';
import { expectNoSeriousA11yViolations } from '../support/axe';

// What a reviewer does on a deployed site (NSTOCK-0281): open the demo, log in with the demo
// account, buy one share at market and see it accepted, and read the guide, with axe clean and no
// uncaught errors.

test('demo login, a market buy, and the guide', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/login?demo=1&redirect=%2Fstocks%2FINFY');
  await logIn(page, '9000000001');
  await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();

  await page.getByRole('main').getByRole('button', { name: 'Buy INFY' }).click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await ticket.getByRole('radio', { name: 'Market' }).check();
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('1');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  // In NSE hours it fills at once; outside them the paper engine places it as an AMO.
  await expect(page.getByRole('region', { name: /^Notifications/ })).toContainText(
    /Order executed\s*BUY 1 INFY @ ₹[\d,]+\.\d{2}|AMO placed\s*BUY 1 INFY/,
  );

  await page.goto('/guide');
  await expect(
    page.getByRole('heading', { level: 1, name: 'nthstock documentation' }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page, '/guide');

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  await expectNoSeriousA11yViolations(page, '/dashboard');
  expect(errors, 'uncaught page errors').toEqual([]);
});

// T26 (SPEC-TFC-1 §13, REQ-DEL-03): a reviewer on a phone. A cold load of /login at 390 px, then
// Try demo, lands on the demo instrument with the chart and the trade bar on screen, with no
// sideways scroll and no uncaught errors.
test('on a 390 px phone: cold load, Try demo, the chart and trade bar', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/login');
  await page.getByRole('button', { name: 'Try demo' }).click();
  await expect(page).toHaveURL(/\/stocks\/RELIANCE$/);
  await expect(page.getByRole('figure', { name: /RELIANCE area chart/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Trade RELIANCE' })).toBeVisible();
  // Try demo turns on demo mode: the labelled Demo simulator is on the page (TFC-12).
  // On a phone it is folded to one button (NSTOCK-0447).
  const simulator = page.getByRole('region', { name: 'Demo simulator' });
  await simulator.getByRole('button', { name: 'Demo controls' }).click();
  await expect(simulator.getByRole('button', { name: 'Rally +1%' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal scroll at 390 px').toBeLessThanOrEqual(0);
  expect(errors, 'uncaught page errors').toEqual([]);
});

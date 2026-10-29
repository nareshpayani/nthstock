import { DEMO_SEED_USER, DEMO_TRADES, DEMO_WATCHLISTS } from '@nthstock/paperEngine';
import { expect, test } from '@playwright/test';
import { logIn } from './support/auth';
import { MONDAY_10_00_IST, setClock } from './support/testControls';

// T-174: ?demo=1 in msw mode starts the demo user with the demo watchlists and holdings
// (docs/runbooks/local-demo.md). apps/api's DEMO_SEED gives the same state (unit-tested on both
// sides against the same builders).

test('?demo=1 seeds the demo user: two watchlists and holdings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/portfolio?demo=1');
  await logIn(page, DEMO_SEED_USER.mobile);
  // The parameter is dropped once used, so a reload keeps the demo's changes.
  await expect(page).toHaveURL(/\/portfolio$/);

  const held = [...new Set(DEMO_TRADES.map((trade) => trade.symbol))];
  const main = page.getByRole('main');
  for (const symbol of held) {
    await expect(main.getByText(symbol, { exact: true }).first()).toBeVisible();
  }
  for (const list of DEMO_WATCHLISTS) {
    await expect(page.getByText(list.name, { exact: true }).first()).toBeAttached();
  }
});

// REQ-DEL-02, TFC-12: Try demo from a cold load of /login gives demo mode, with the labelled Demo
// simulator on the instrument page and the demo account's holdings, the same as ?demo=1 (the
// walkthrough relies on it).
test('Try demo opens the instrument page with the Demo simulator and the demo account', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // In market hours, so the demo position fills and no notice covers the page.
  await setClock(page, MONDAY_10_00_IST);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Try demo' }).click();
  await expect(page).toHaveURL(/\/stocks\/RELIANCE$/);
  const simulator = page.getByRole('region', { name: 'Demo simulator' });
  await expect(simulator).toBeVisible();
  // On a phone the panel is folded to one button (NSTOCK-0447).
  await expect(simulator.getByRole('button', { name: 'Rally +1%' })).toBeHidden();
  await simulator.getByRole('button', { name: 'Demo controls' }).click();
  await expect(simulator.getByRole('button', { name: 'Rally +1%' })).toBeVisible();

  // The demo account comes with it: the seeded holdings are in the portfolio.
  await page.goto('/portfolio');
  const main = page.getByRole('main');
  for (const symbol of new Set(DEMO_TRADES.map((trade) => trade.symbol))) {
    await expect(main.getByText(symbol, { exact: true }).first()).toBeVisible();
  }
});

// NSTOCK-0444: the reviewer link signs in from a cold load, with no tap, and lands on the chart
// with the demo position and its trailing stop.
test('/login?try=1 opens RELIANCE signed in with a position and a trailing stop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // In market hours, so the demo's market buy fills (the test build keeps NSE hours).
  await setClock(page, MONDAY_10_00_IST);
  await page.goto('/login?try=1');
  await expect(page).toHaveURL(/\/stocks\/RELIANCE$/, { timeout: 20_000 });
  await expect(page.getByRole('figure', { name: /RELIANCE area chart/ })).toBeVisible();
  const bar = page.getByTestId('phone-trade-bar');
  await expect(bar).toContainText(/\+10\s*@ ₹[\d,]+\.\d{2}/);
  await expect(bar).toContainText(/Trailing stop ₹[\d,]+\.\d{2}/);
});

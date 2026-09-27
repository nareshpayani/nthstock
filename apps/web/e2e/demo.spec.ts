import { DEMO_SEED_USER, DEMO_TRADES, DEMO_WATCHLISTS } from '@nthstock/paperEngine';
import { expect, test } from '@playwright/test';
import { logIn } from './support/auth';

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

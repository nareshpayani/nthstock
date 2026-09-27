import { expect, test } from '@playwright/test';
import { logIn } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';
import { MONDAY_10_00_IST, setClock } from './support/testControls';

// T-166: axe (WCAG 2.2 AA rules) on every route while logged in, on the open order ticket (form and
// review), and on the login page, with zero serious or critical violations. The clock sits on a
// trading Monday, 10:00 IST, so every page shows its market-open state, and one buy fills the order
// book, positions and funds ledger before axe looks at them.

const ROUTES = [
  { path: '/dashboard', heading: /^Good (morning|afternoon|evening)/ },
  { path: '/stocks/INFY', heading: 'Infosys Ltd' },
  { path: '/orders', heading: 'Orders' },
  { path: '/positions', heading: 'Positions' },
  { path: '/portfolio', heading: 'Portfolio' },
  { path: '/funds', heading: 'Funds' },
] as const;

test('axe finds no serious or critical violations on any route or the order ticket', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setClock(page, MONDAY_10_00_IST);
  await page.goto('/login?redirect=%2Fdashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Log in to nthstock' })).toBeVisible();
  await expectNoSeriousA11yViolations(page, '/login');
  await logIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);

  // The open order ticket (a modal slide-over) and its review step, then a buy, so the order book,
  // positions and funds below show rows rather than empty states.
  await page.goto('/stocks/INFY');
  await page.getByRole('main').getByRole('button', { name: 'Buy INFY' }).click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();
  await expect(ticket.getByRole('textbox', { name: 'Price (₹)' })).toHaveValue(/^\d+\.\d{2}$/);
  await expectNoSeriousA11yViolations(page, 'the order ticket');
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('2');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await expect(ticket.getByRole('heading', { name: 'Review your order' })).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'the order ticket review step');
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();

  for (const route of ROUTES) {
    await page.goto(route.path);
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
    // Skeletons gone: every page's data has loaded before axe looks.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    await expectNoSeriousA11yViolations(page, route.path);
  }
});

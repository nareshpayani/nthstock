import { DEMO_SEED_USER } from '@nthstock/paperEngine';
import { expect, test, type Page } from '@playwright/test';
import { logIn } from './support/auth';

// The phone app shell (NSTOCK-0466): below 768 px a bottom tab bar replaces the menu drawer. This
// walks from the tabs to every feature the desktop reaches through its header, rail and menus, so
// nothing the web app has is lost on a phone. A new desktop page or menu entry gets a step here.

/** Monday 28 Sep 2026, 10:00 IST: NSE open, so a market order fills. */
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Main' }).last();
const tab = (page: Page, name: string) => tabBar(page).getByRole('link', { name, exact: true });

test.describe('the phone app shell reaches every feature (NSTOCK-0466)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(MONDAY_10_IST);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login?demo=1&redirect=%2Fdashboard');
    await logIn(page, DEMO_SEED_USER.mobile);
    await page.waitForURL(/\/dashboard/);
  });

  test('tabs, top bar and Home', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
    await expect(tabBar(page)).toBeInViewport();
    for (const name of ['Home', 'Portfolio', 'Orders', 'Account'])
      await expect(tab(page, name)).toBeVisible();
    await expect(tab(page, 'Home')).toHaveAttribute('aria-current', 'page');

    // Home: the value, the chart, the two actions, the lists, the indices.
    await expect(page.getByRole('heading', { level: 1, name: 'Portfolio value' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add funds' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Place order' })).toBeVisible();
    const feed = page.getByRole('tablist', { name: 'Stocks' });
    await expect(feed.getByRole('tab')).toHaveText(['Watchlist', 'Gainers', 'Losers']);
    await expect(page.getByRole('tabpanel').getByRole('link').first()).toBeVisible();
    await feed.getByRole('tab', { name: 'Gainers' }).click();
    await expect(page).toHaveURL(/feed=gainers/);
    await page.getByRole('radiogroup', { name: 'Index' }).getByRole('radio').nth(1).click();
    await expect(page).toHaveURL(/moversIndex=/);
    await expect(page.getByRole('heading', { name: 'Market indices' })).toBeAttached();

    // The top bar: the Market | Watchlist switch and the index strip.
    const homeView = page.getByRole('navigation', { name: 'Home view' });
    await homeView.getByRole('link', { name: 'Watchlist' }).click();
    await expect(page).toHaveURL(/\/watchlist$/);
    await expect(page.getByRole('region', { name: 'Watchlists' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sort watchlist' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Market status and indices' })).toBeVisible();
  });

  test('Portfolio, Orders and the bell', async ({ page }) => {
    await tab(page, 'Portfolio').click();
    await expect(page).toHaveURL(/\/portfolio$/);
    const view = page.getByRole('navigation', { name: 'Portfolio view' });
    await view.getByRole('link', { name: 'Positions' }).click();
    await expect(page).toHaveURL(/\/positions$/);
    await expect(tab(page, 'Portfolio')).toHaveAttribute('aria-current', 'page');

    await tab(page, 'Orders').click();
    await expect(page).toHaveURL(/\/orders/);
    await expect(page.getByRole('tablist', { name: /orders/i })).toBeVisible();

    // Notifications and price alerts live in the bell, as on the desktop.
    await page
      .getByRole('button', { name: /notifications/i })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Price alerts' })).toBeVisible();
  });

  test('Account holds funds, security, privacy, the guide and log out', async ({ page }) => {
    await tab(page, 'Account').click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('region', { name: 'Profile' })).toContainText('Demo Investor');
    const menu = page.getByRole('navigation', { name: 'Account' });
    const destinations = [
      ['Funds', /\/funds$/],
      ['Positions', /\/positions$/],
      ['Watchlists', /\/watchlist$/],
      ['Security and privacy', /\/settings\/security$/],
      ['Help and documentation', /\/guide/],
    ] as const;
    for (const [name, url] of destinations) {
      await tab(page, 'Account').click();
      await menu.getByRole('link', { name: new RegExp(`^${name}`) }).click();
      await expect(page).toHaveURL(url);
    }
    // Security holds two-factor, sessions, consent and account deletion.
    await tab(page, 'Account').click();
    await menu.getByRole('link', { name: /^Security and privacy/ }).click();
    await expect(page.getByRole('heading', { name: /two-factor/i }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /logged in/i }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /delete/i }).first()).toBeVisible();

    await tab(page, 'Account').click();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
  });

  test('Trade: search, then the stock page with the ticket up, then back', async ({ page }) => {
    await page.getByRole('button', { name: /^Trade:/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Trade' });
    await expect(sheet).toBeVisible();
    const search = sheet.getByRole('combobox', { name: 'Search stocks' });
    await expect(search).toBeFocused();
    await page.keyboard.type('infy');
    await sheet.getByRole('option').first().click();
    await expect(page).toHaveURL(/\/stocks\/INFY$/);
    const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
    await expect(ticket).toBeVisible();
    await ticket.getByRole('button', { name: 'Close' }).first().click();
    await expect(ticket).toBeHidden();

    // A stock's page is pushed over the tabs: its own Sell, Buy and Scalp bar, a back button.
    await expect(tabBar(page)).toBeHidden();
    await expect(page.getByRole('group', { name: 'Trade INFY' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(tabBar(page)).toBeVisible();
  });

  test('"Place order" on Home opens the same trade sheet', async ({ page }) => {
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('dialog', { name: 'Trade' })).toBeVisible();
  });
});

test('a tablet keeps the drawer, a desktop the header tabs (NSTOCK-0466)', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1024 });
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Trade:/ })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
  await expect(page.getByRole('button', { name: /^Trade:/ })).toHaveCount(0);
});

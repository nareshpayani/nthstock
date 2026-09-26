import { expect, test } from '@playwright/test';

// App-shell smoke test (T-030): routing, header, rail, shortcuts and responsive layout.

test('/ redirects to the dashboard and shows the shell', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)$/ }),
  ).toBeVisible();

  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    page.getByRole('banner').getByText('NIFTY 50', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Watchlist and search' })).toBeVisible();
  await expect(page.getByText('Your watchlist is empty').first()).toBeVisible();

  await nav.getByRole('link', { name: 'Orders' }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');
});

test('keyboard: / focuses search and ? opens the shortcut list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.keyboard.press('/');
  const search = page.getByRole('complementary').getByRole('searchbox', { name: 'Search stocks' });
  await expect(search).toBeFocused();
  await page.keyboard.type('?');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await search.blur();
  await page.keyboard.press('Shift+?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('unknown URLs show the 404 page', async ({ page }) => {
  await page.goto('/nope');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

for (const width of [360, 390, 768, 1024, 1440]) {
  test(`no horizontal scroll at ${String(width)} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/dashboard');
    await page.getByRole('heading', { level: 1 }).waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('under 1024 px the rail and tabs live in a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await expect(page.getByRole('complementary', { name: 'Watchlist and search' })).toBeHidden();
  await page.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('searchbox', { name: 'Search stocks' })).toBeFocused();
  await drawer.getByRole('link', { name: 'Funds' }).click();
  await expect(page).toHaveURL(/\/funds$/);
  await expect(drawer).toBeHidden();
});

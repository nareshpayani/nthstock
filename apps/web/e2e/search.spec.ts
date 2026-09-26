import { expect, test } from '@playwright/test';

// T-103 and T-104: stock search on MSW data, keyboard only.
test('/ focuses search; typing, ↓ and Enter open the stock; an empty box shows recent then popular', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  await page.getByRole('heading', { level: 1 }).waitFor();

  await page.keyboard.press('/');
  const search = page.getByRole('complementary').getByRole('combobox', { name: 'Search stocks' });
  await expect(search).toBeFocused();

  await page.keyboard.type('infy');
  const list = page.getByRole('complementary').getByRole('listbox', { name: 'Stock suggestions' });
  const first = list.getByRole('option').first();
  await expect(first).toContainText('INFY');
  await expect(first).toContainText('Infosys Ltd');
  await expect(first).toContainText('NSE');
  await expect(first.locator('mark').first()).toHaveText('INFY');

  await page.keyboard.press('ArrowDown');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  await expect(search).toHaveValue('');

  await search.blur();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  const recent = list.getByRole('group', { name: 'Recent searches' });
  const popular = list.getByRole('group', { name: 'Popular searches' });
  await expect(recent.getByRole('option')).toHaveCount(1);
  await expect(recent.getByRole('option')).toContainText('INFY');
  await expect(popular.getByRole('option').first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await expect(search).not.toBeFocused();
});

test('in the phone drawer, Esc closes only the list and choosing a stock closes the drawer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.keyboard.press('/');
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  const search = drawer.getByRole('combobox', { name: 'Search stocks' });
  await expect(search).toBeFocused();

  await page.keyboard.type('tcs');
  await expect(drawer.getByRole('option').first()).toContainText('TCS');
  await page.keyboard.press('Escape');
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await expect(drawer).toBeVisible();
  await expect(search).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/stocks\/TCS$/);
  await expect(drawer).toBeHidden();
});

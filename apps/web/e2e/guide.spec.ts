import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/axe';

// NSTOCK-0280: the reviewer guide opens without logging in, from the login page and the More menu,
// its contents links jump to their sections, and axe finds nothing serious on it.

test('the guide is public, linked from login and the More menu, and accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByRole('link', { name: 'New here? Read the guide' }).click();
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByRole('heading', { level: 1, name: 'nthstock guide' })).toBeVisible();
  await expect(page).toHaveTitle('Guide · nthstock');

  const toc = page.getByRole('navigation', { name: 'On this page' });
  await toc.getByRole('link', { name: 'How to buy a stock' }).click();
  await expect(page).toHaveURL(/#buy$/);
  await expect(
    page.getByRole('heading', { level: 2, name: 'How to buy a stock' }),
  ).toBeInViewport();

  await expectNoSeriousA11yViolations(page, '/guide');

  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Guide: features and how to trade' }).click();
  await expect(page).toHaveURL(/\/guide$/);
});

test('the guide fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/guide');
  await expect(page.getByRole('heading', { level: 1, name: 'nthstock guide' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

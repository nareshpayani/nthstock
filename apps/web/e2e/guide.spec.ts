import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/axe';

// NSTOCK-0280, tabbed in NSTOCK-0341: the reviewer guide opens without logging in, from the login
// page and the More menu; each topic is a tab whose URL can be shared; axe finds nothing serious
// on the topics with diagrams and tables; and it fits a phone without sideways scrolling.

test('the guide is public, linked from login and the More menu, and accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByRole('link', { name: 'Guide: how nthstock works' }).click();
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.getByRole('heading', { level: 1, name: 'nthstock guide' })).toBeVisible();
  await expect(page).toHaveTitle('Guide · nthstock');
  // From the guide straight on to logging in.
  await page.getByRole('link', { name: 'Log in to start' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Log in to nthstock' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'nthstock guide' })).toBeVisible();

  await expectNoSeriousA11yViolations(page, '/guide');

  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Guide: features and how to trade' }).click();
  await expect(page).toHaveURL(/\/guide$/);
});

test('each topic is a tab with its own link, kept on reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/guide');
  const tabs = page.getByRole('tablist', { name: 'Guide topics' });
  await expect(tabs.getByRole('tab')).toHaveCount(16);

  await tabs.getByRole('tab', { name: 'Scalability' }).click();
  await expect(page).toHaveURL(/\/guide\?tab=scalability$/);
  await expect(
    page.getByRole('heading', { level: 2, name: /Scalability: 1,000 to 10,000 users/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: /API p95 latency by concurrent users/ }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Scalability · Guide · nthstock');

  // Arrow keys move between tabs (the tab list is a column on wide screens).
  await tabs.getByRole('tab', { name: 'Scalability' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page).toHaveURL(/\?tab=security$/);

  await page.reload();
  await expect(tabs.getByRole('tab', { name: 'Security' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // The pager walks on to the next topic.
  await page.getByRole('button', { name: 'Next: Folder structure →' }).click();
  await expect(page).toHaveURL(/\?tab=folders$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Folder structure' })).toBeFocused();

  for (const tab of ['architecture', 'scalability', 'agents']) {
    await page.goto(`/guide?tab=${tab}`);
    await expect(page.getByRole('tabpanel').getByRole('img').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, `/guide?tab=${tab}`);
  }
});

test('the guide fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['overview', 'architecture', 'scalability', 'folders', 'ci-cd']) {
    await page.goto(`/guide?tab=${tab}`);
    await expect(page.getByRole('heading', { level: 1, name: 'nthstock guide' })).toBeVisible();
    await expect(page.getByRole('tabpanel')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, tab).toBeLessThanOrEqual(0);
  }
  // Every tab is a 44 px target.
  for (const box of await page
    .getByRole('tab')
    .evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().height))) {
    expect(box).toBeGreaterThanOrEqual(44);
  }
});

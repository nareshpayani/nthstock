import { expect, test } from '@playwright/test';

// NSTOCK-0437: every index opens its own chart page, from the dashboard cards, the header tickers
// and the NIFTY 50 chart (a tap opens it, a drag pans), and every chart opens on 1D.

test('index cards, header tickers and the dashboard chart open the index pages', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('radio', { name: '1D', exact: true })).toBeChecked();

  const indices = page.getByRole('region', { name: 'Market indices' });
  await indices.getByRole('link', { name: /NIFTY BANK/ }).click();
  await expect(page).toHaveURL(/\/stocks\/NIFTYBANK\?exchange=NSE$/);
  await expect(page.getByRole('heading', { level: 1, name: 'NIFTY BANK' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '1D', exact: true })).toBeChecked();

  await page
    .getByRole('banner')
    .getByRole('link', { name: /^SENSEX/ })
    .click();
  await expect(page).toHaveURL(/\/stocks\/SENSEX\?exchange=BSE$/);
  await expect(page.getByRole('heading', { level: 1, name: 'SENSEX' })).toBeVisible();

  await page.goto('/dashboard');
  const plot = page.getByTestId('dashboard-chart');
  await expect(plot.locator('canvas').first()).toBeVisible();
  const box = await plot.boundingBox();
  if (!box) throw new Error('no chart');
  // A drag pans the chart and stays on the dashboard.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  // A tap opens the full NIFTY 50 page on the same range.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/stocks\/NIFTY50\?exchange=NSE&range=1D$/);
  await expect(page.getByRole('heading', { level: 1, name: 'NIFTY 50' })).toBeVisible();
});

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
  // A tap opens the full NIFTY 50 page on the same range and chart type (a line by default).
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/stocks\/NIFTY50\?exchange=NSE&range=1D&chart=line$/);
  await expect(page.getByRole('heading', { level: 1, name: 'NIFTY 50' })).toBeVisible();
});

// NSTOCK-0440: an index trades through the ETF that tracks it.
test('an index page trades its tracking ETF', async ({ page }) => {
  await page.goto('/stocks/NIFTYBANK?exchange=NSE');
  const card = page.getByTestId('index-etf-card');
  await expect(card.getByRole('heading', { name: 'Trade NIFTY BANK' })).toBeVisible();
  // Signed out, Buy goes through login first.
  await card.getByRole('button', { name: 'Buy ETF, NIFTY BANK ETF' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto('/stocks/NIFTYBANK?exchange=NSE');
  await page.getByRole('link', { name: 'View NIFTY BANK ETF' }).click();
  await expect(page).toHaveURL(/\/stocks\/BANKETF\?exchange=NSE$/);
  await expect(page.getByRole('heading', { level: 1, name: 'NIFTY BANK ETF' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buy BANKETF' })).toBeVisible();
});

test('on a phone the index page keeps Buy and Sell ETF in a bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/stocks/SENSEX?exchange=BSE');
  const bar = page.getByTestId('index-etf-bar');
  await expect(bar.getByRole('button', { name: 'Sell ETF, SENSEX ETF' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Buy ETF, SENSEX ETF' })).toBeInViewport();
});

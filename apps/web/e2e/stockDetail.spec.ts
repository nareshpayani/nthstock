import { expect, test } from '@playwright/test';

// T-105 to T-109: stock detail on MSW data (the e2e build forces the mock market open).
test('stock detail: title, live header, URL chart range and type, key stats, Buy asks to log in', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/stocks/INFY');

  await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();
  await expect(page).toHaveTitle('Infosys Ltd (INFY) · nthstock');
  await expect(page.getByRole('radio', { name: 'BSE' })).toBeDisabled();

  const chart = page.getByRole('figure', { name: 'INFY area chart over 1 day' });
  await expect(chart.locator('canvas').first()).toBeVisible();

  await page.getByRole('radio', { name: '1M' }).click();
  await expect(page).toHaveURL(/\/stocks\/INFY\?range=1M$/);
  await expect(page.getByRole('figure', { name: 'INFY area chart over 1 month' })).toBeVisible();

  await page.getByRole('radio', { name: 'Candles' }).click();
  await expect(page).toHaveURL(/range=1M&chart=candle$/);
  const candles = page.getByRole('figure', { name: 'INFY candlestick chart over 1 month' });
  await expect(candles.locator('canvas').first()).toBeVisible();

  // Hovering the chart shows the crosshair tooltip with en-IN grouped rupees.
  const box = await candles.boundingBox();
  if (!box) throw new Error('chart has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('chart-tooltip')).toContainText(/Close₹[\d,]+\.\d{2}/);

  const stats = page.getByRole('region', { name: 'Key stats' });
  await expect(stats.getByText(/^₹[\d,]+(\.\d{1,2})? Cr$/)).toBeVisible();
  await expect(stats.getByRole('img', { name: /^Day range: low ₹/ })).toBeVisible();

  await page.getByRole('button', { name: 'Buy INFY' }).click();
  await expect(page).toHaveURL(/\/login\?redirect=/);
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(
    '/stocks/INFY?range=1M&chart=candle',
  );
});

test('an unknown symbol shows not-found', async ({ page }) => {
  await page.goto('/stocks/NOPE');
  await expect(page.getByRole('heading', { level: 1, name: 'Stock not found' })).toBeVisible();
  await expect(page).toHaveTitle('Stock not found · nthstock');
  await expect(page.getByText(/We could not find NOPE/)).toBeVisible();
});

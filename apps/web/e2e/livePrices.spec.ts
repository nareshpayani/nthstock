import { expect, test } from '@playwright/test';

// T-078: in msw mode the app boots with MSW and a live price changes within 2 s. The e2e build sets
// VITE_MOCK_MARKET_OPEN=true (playwright.config.ts), so the mock market ticks outside NSE hours.

test('msw mode boots and a LivePrice ticks within 2 s', async ({ page }) => {
  const console: string[] = [];
  page.on('console', (message) => console.push(message.text()));
  await page.goto('/dev/prices');
  await expect(page.getByRole('heading', { level: 1, name: 'Live prices' })).toBeVisible();

  const nifty = page.getByTestId('live-NIFTY50').locator('dd');
  await expect(nifty).toHaveText(/^\d{1,3}(,\d{2})*,?\d{3}\.\d{2}[▲▼]$/);
  const first = await nifty.textContent();
  await expect
    .poll(() => nifty.textContent(), { timeout: 2_000, intervals: [100] })
    .not.toBe(first);
  await expect(nifty.locator('[data-tick]')).toHaveAttribute('data-tick', /^(up|down)$/);
  await expect(page.getByTestId('live-INFY').locator('dd')).toHaveText(/^₹[\d,]+\.\d{2}[▲▼]$/);
  expect(console.some((text) => text.includes('[MSW] Mocking enabled'))).toBe(true);
});

test('the header Nifty 50 and Sensex are live', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  const tickers = page.getByRole('banner').getByRole('group', { name: 'Market indices' }).first();
  await expect(tickers.getByText(/^NIFTY 50 [\d,]+\.\d{2}, /)).toBeAttached();
  await expect(tickers.getByText(/^SENSEX [\d,]+\.\d{2}, /)).toBeAttached();
  const spoken = tickers.getByText(/^NIFTY 50 [\d,]+\.\d{2}, /);
  const first = await spoken.textContent();
  await expect.poll(() => spoken.textContent(), { timeout: 3_000 }).not.toBe(first);
});

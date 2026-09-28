import { expect, test } from '@playwright/test';

// Chrome stops an idle service worker (a sleeping laptop, a tab left open overnight). MSW's
// restarted worker has forgotten the tab, so before the keeper (mocks/workerKeeper.ts) every /v1
// request went to the dev server and each section showed its "unavailable" error until a reload.

test('data keeps loading after Chrome restarts the mock service worker', async ({
  page,
  context,
}) => {
  const passedThrough: string[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    // /v1/auth/refresh answers 401 without a session; that is the mock, not a pass-through.
    if (
      url.pathname.startsWith('/v1/') &&
      response.status() === 404 &&
      !response.fromServiceWorker()
    ) {
      passedThrough.push(url.pathname);
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Market Indices' })).toBeVisible();

  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');

  // A client-side navigation, as clicking a stock does, so no reload re-runs MSW's start.
  await page.evaluate(() => {
    window.history.pushState({}, '', '/stocks/TCS');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(
    page.getByRole('heading', { level: 1, name: /TCS|Tata Consultancy/i }),
  ).toBeVisible();
  await expect(page.getByText(/could not find TCS/i)).toHaveCount(0);
  expect(passedThrough).toEqual([]);
});

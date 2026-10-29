import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { TOUCH_TAG } from './support/env';
import { centreOf, touchscreen, type Touch } from './support/touch';

// NSTOCK-0470: a phone watchlist driven by touch alone. Each row's "⋯" button opens Buy, Sell,
// Move up, Move down and Remove; every one is a 44 px target and needs no hover and no drag.

/** Resolves when the next watchlist change (POST, PATCH, PUT or DELETE) has been answered. */
function nextChange(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url().includes('/v1/watchlists') && response.request().method() !== 'GET',
  );
}

async function tap(touch: Touch, target: Locator) {
  await touch.tap(await centreOf(target));
}

/** Rendered height in CSS px. */
async function heightOf(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('not rendered');
  return box.height;
}

test(`watchlist row actions by touch: buy, reorder and remove (NSTOCK-0470) ${TOUCH_TAG}`, async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Stocks are added from the desktop rail's search, whose results carry a + button; the rest of
  // the journey is on the phone.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login?redirect=%2Fdashboard');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/dashboard$/);
  const rail = page.getByRole('complementary', { name: 'Watchlist and search' });
  const search = rail.getByRole('combobox', { name: 'Search stocks' });
  for (const symbol of ['INFY', 'TCS']) {
    await search.fill(symbol.toLowerCase());
    const add = rail.locator(`[data-add-to-watchlist="${symbol}"]`);
    await expect(add).toBeVisible();
    const added = nextChange(page);
    await add.click();
    await added;
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/watchlist');
  const touch = await touchscreen(page);
  const panel = page.getByRole('region', { name: 'Watchlists' });

  const rows = panel.getByRole('list', { name: /^Stocks in / });
  const symbols = () =>
    rows
      .getByRole('listitem')
      .evaluateAll((items) =>
        items
          .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
          .map((item) => item.querySelector('a span span')?.textContent),
      );
  await expect.poll(symbols).toEqual(['INFY', 'TCS']);
  // No hover buttons and no drag grip on touch.
  await expect(rows.getByRole('button', { name: 'Buy INFY' })).toHaveCount(0);
  await expect(rows.locator('[data-drag-handle]')).toHaveCount(0);

  const actions = (symbol: string) => rows.getByRole('button', { name: `${symbol} actions` });
  expect(await heightOf(actions('INFY'))).toBeGreaterThanOrEqual(44);

  // Buy: one tap opens the menu, one more the order ticket.
  await tap(touch, actions('INFY'));
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  // The menu scales in; measure once it has settled.
  await menu.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  for (const item of await menu.getByRole('menuitem').all())
    expect(await heightOf(item)).toBeGreaterThanOrEqual(44);
  await tap(touch, menu.getByRole('menuitem', { name: 'Buy INFY' }));
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();
  await page.goto('/watchlist');

  // Move INFY down below TCS.
  const moved = nextChange(page);
  await tap(touch, actions('INFY'));
  await tap(touch, page.getByRole('menu').getByRole('menuitem', { name: /Move down/ }));
  await moved;
  await expect.poll(symbols).toEqual(['TCS', 'INFY']);

  // Remove TCS.
  const removed = nextChange(page);
  await tap(touch, actions('TCS'));
  await tap(touch, page.getByRole('menu').getByRole('menuitem', { name: 'Remove TCS' }));
  await removed;
  await expect.poll(symbols).toEqual(['INFY']);
});

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
  await page.goto('/login?redirect=%2Fwatchlist');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/watchlist$/);
  const touch = await touchscreen(page);
  const panel = page.getByRole('region', { name: 'Watchlists' });

  // Add stock opens the add sheet on the phone: INFY with its +, TCS by tapping its row.
  const addStock = page.getByRole('button', { name: 'Add stock' }).first();
  expect(await heightOf(addStock)).toBeGreaterThanOrEqual(44);
  await tap(touch, addStock);
  const sheet = page.getByRole('dialog', { name: /^Add to / });
  await expect(sheet).toBeVisible();
  const search = sheet.getByRole('combobox', { name: 'Search stocks' });
  await search.fill('infy');
  const plus = sheet.locator('[data-add-to-watchlist="INFY"]');
  await expect(plus).toBeVisible();
  expect(await heightOf(plus)).toBeGreaterThanOrEqual(44);
  let added = nextChange(page);
  await tap(touch, plus);
  await added;
  await search.fill('tcs');
  const tcs = sheet.getByRole('option', { name: /^TCS/ });
  await expect(tcs).toBeVisible();
  added = nextChange(page);
  await tap(touch, tcs);
  await added;
  // Adding keeps the sheet open on the list, for the next stock.
  await expect(page).toHaveURL(/\/watchlist$/);
  await expect(sheet).toBeVisible();
  await tap(touch, sheet.getByRole('button', { name: 'Close' }));
  await expect(sheet).toBeHidden();

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

  // Every target in the menu is at least 44 px.
  await tap(touch, actions('INFY'));
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  // The menu scales in; measure once it has settled.
  await menu.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  for (const item of await menu.getByRole('menuitem').all())
    expect(await heightOf(item)).toBeGreaterThanOrEqual(44);

  // Move INFY down below TCS, from the menu already open.
  const moved = nextChange(page);
  await tap(touch, menu.getByRole('menuitem', { name: /Move down/ }));
  await moved;
  await expect.poll(symbols).toEqual(['TCS', 'INFY']);

  // Remove TCS.
  const removed = nextChange(page);
  await tap(touch, actions('TCS'));
  await tap(touch, page.getByRole('menu').getByRole('menuitem', { name: 'Remove TCS' }));
  await removed;
  await expect.poll(symbols).toEqual(['INFY']);

  // Buy last: it opens the order ticket, which leaves the list, so nothing comes after it.
  await tap(touch, actions('INFY'));
  await tap(touch, page.getByRole('menu').getByRole('menuitem', { name: 'Buy INFY' }));
  await expect(page.getByRole('dialog', { name: 'Trade INFY' })).toBeVisible();
});

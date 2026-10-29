import { DEMO_SEED_USER } from '@nthstock/paperEngine';
import { expect, test, type Locator } from '@playwright/test';
import { logIn } from './support/auth';
import { TOUCH_TAG } from './support/env';
import { centreOf, touchscreen } from './support/touch';

// NSTOCK-0470: watchlist rows on a phone. Every action is one tap on the row's "⋯" button and a
// menu item, no hover and no drag, and every touch target is at least 44 px tall (§6.3).
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST so NSE is open.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');
const MIN_TARGET_PX = 44;

async function expectTouchSize(target: Locator) {
  const box = await target.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET_PX);
}

test(`watchlist row actions by touch: buy, move and remove (NSTOCK-0470) ${TOUCH_TAG}`, async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(MONDAY_10_IST);
  await page.goto('/login?demo=1&redirect=%2Fwatchlist');
  await logIn(page, DEMO_SEED_USER.mobile);
  await expect(page).toHaveURL(/\/watchlist$/);
  const touch = await touchscreen(page);

  const list = page.getByRole('list', { name: 'Stocks in My Watchlist' });
  const symbols = () =>
    list
      .getByRole('listitem')
      .evaluateAll((items) =>
        items
          .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
          .map((item) => item.querySelector('a span span')?.textContent),
      );
  await expect.poll(symbols).toEqual(['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'ITC', 'BHARTIARTL']);

  const open = async (symbol: string) => {
    const trigger = page.getByRole('button', { name: `${symbol} actions` });
    await expectTouchSize(trigger);
    await touch.tap(await centreOf(trigger));
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    return menu;
  };
  const choose = async (name: string | RegExp) =>
    touch.tap(await centreOf(page.getByRole('menuitem', { name })));

  // Every menu item is a 44 px target, with the items touching or more than 8 px apart.
  const menu = await open('INFY');
  const items = menu.getByRole('menuitem');
  const count = await items.count();
  expect(count).toBe(5);
  for (let i = 0; i < count; i += 1) await expectTouchSize(items.nth(i));
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Buy opens the order ticket.
  await open('INFY');
  await choose('Buy INFY');
  await expect(page.getByRole('dialog', { name: 'Trade INFY' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Trade INFY' })).toBeHidden();

  // Move down swaps INFY with ITC.
  await open('INFY');
  await choose(/Move down/);
  await expect.poll(symbols).toEqual(['RELIANCE', 'HDFCBANK', 'TCS', 'ITC', 'INFY', 'BHARTIARTL']);

  // Remove drops the row.
  await open('INFY');
  await choose(/Remove from list/);
  await expect(list.getByRole('link', { name: /^INFY/ })).toHaveCount(0);
  await expect.poll(symbols).toEqual(['RELIANCE', 'HDFCBANK', 'TCS', 'ITC', 'BHARTIARTL']);
});

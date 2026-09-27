import { expect, test, type Page } from '@playwright/test';

// T-126: the watchlist journey in msw mode. Log in, create a list, search INFY and add it (plus
// TCS), reorder by drag and by Alt+↓, sort, and remove, with the changes surviving a reload.

/** Resolves when the next watchlist change (POST, PATCH, PUT or DELETE) has been answered. */
function nextChange(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url().includes('/v1/watchlists') && response.request().method() !== 'GET',
  );
}

async function logIn(page: Page) {
  await page.goto('/login?redirect=%2Fdashboard');
  await page.getByRole('textbox', { name: 'Mobile number' }).fill('9876512345');
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await page.getByRole('group', { name: 'One-time password' }).getByRole('textbox').first().click();
  await page.keyboard.type('123456');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('create a list, search and add INFY, reorder, sort and remove', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await logIn(page);

  const rail = page.getByRole('complementary', { name: 'Watchlist and search' });
  await expect(rail.getByRole('tab', { name: 'My Watchlist' })).toBeVisible();
  await expect(rail.getByText('This watchlist is empty')).toBeVisible();

  // Create "Tech"; it opens as the active tab.
  await rail.getByRole('button', { name: 'New watchlist' }).click();
  const dialog = page.getByRole('dialog', { name: 'New watchlist' });
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await page.keyboard.type('Tech');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(rail.getByRole('tab', { name: 'Tech' })).toHaveAttribute('aria-selected', 'true');

  // Search INFY and add it with Shift+Enter; TCS with the + on its result.
  await page.keyboard.press('/');
  const search = rail.getByRole('combobox', { name: 'Search stocks' });
  await expect(search).toBeFocused();
  await page.keyboard.type('infy');
  await expect(rail.getByRole('option').first()).toContainText('INFY');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+Enter');
  const rows = rail.getByRole('list', { name: 'Stocks in Tech' });
  await expect(rows.getByRole('listitem')).toHaveCount(1);
  await expect(rows.getByRole('link', { name: /^INFY NSE/ })).toBeVisible();
  await expect(rail.getByRole('option').first()).toContainText('In Tech');

  await search.fill('tcs');
  await expect(rail.getByRole('option').first()).toContainText('TCS');
  const tcsAdded = nextChange(page);
  await rail.locator('[data-add-to-watchlist="TCS"]').click();
  await tcsAdded;
  await page.keyboard.press('Escape');
  const symbols = () =>
    rows
      .getByRole('listitem')
      .evaluateAll((items) =>
        items
          .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
          .map((item) => item.querySelector('a span span')?.textContent),
      );
  await expect.poll(symbols).toEqual(['INFY', 'TCS']);
  // Live prices: each row shows a rupee price.
  await expect(rows.getByRole('link', { name: /^INFY NSE ₹/ })).toBeVisible();

  // The list survives a reload (MSW keeps it in sessionStorage; the refresh cookie the session).
  await page.reload();
  await expect(rail.getByRole('tab', { name: 'Tech' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(symbols).toEqual(['INFY', 'TCS']);

  // Reorder by dragging TCS's handle above INFY.
  const tcsRow = rows.getByRole('listitem').filter({ hasText: 'TCS' });
  await tcsRow.hover();
  const handle = rail.locator('[data-drag-handle="TCS"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error('no drag handle');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 20, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y - 50, { steps: 5 });
  const dragged = nextChange(page);
  await page.mouse.up();
  await expect.poll(symbols).toEqual(['TCS', 'INFY']);
  await dragged;

  // And back with the keyboard: Alt+↓ on the focused TCS row, announced.
  await rows.getByRole('link', { name: /^TCS NSE/ }).focus();
  const movedDown = nextChange(page);
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(symbols).toEqual(['INFY', 'TCS']);
  await movedDown;
  await expect(rows.getByRole('link', { name: /^TCS NSE/ })).toBeFocused();
  await expect(
    rail.getByRole('status').filter({ hasText: 'TCS moved to position 2 of 2' }),
  ).toHaveCount(1);
  const movedUp = nextChange(page);
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(symbols).toEqual(['TCS', 'INFY']);
  await movedUp;

  // The saved order persists.
  await page.reload();
  await expect.poll(symbols).toEqual(['TCS', 'INFY']);

  // Sort by name, then back to the custom (saved) order.
  const sortButton = rail.getByRole('button', { name: /^Sort watchlist/ });
  await sortButton.click();
  await page.getByRole('menuitemradio', { name: 'Name (A to Z)' }).click();
  await expect.poll(symbols).toEqual(['INFY', 'TCS']);
  await expect(rail.locator('[data-drag-handle]')).toHaveCount(0);
  await sortButton.click();
  await expect(page.getByRole('menuitemradio', { name: 'Name (A to Z)' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: 'Custom order' }).click();
  await expect.poll(symbols).toEqual(['TCS', 'INFY']);

  // Remove INFY from its row actions.
  await rows.getByRole('listitem').filter({ hasText: 'INFY' }).hover();
  const removed = nextChange(page);
  await rail.getByRole('button', { name: 'Remove INFY' }).click();
  await expect.poll(symbols).toEqual(['TCS']);
  await removed;
  await page.reload();
  await expect.poll(symbols).toEqual(['TCS']);
});

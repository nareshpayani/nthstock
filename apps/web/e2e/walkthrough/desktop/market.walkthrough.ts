import { expect, type Page } from '@playwright/test';
import { clip, freshMobile, logInOnScreen, MONDAY_10_00_IST } from '../support/clip';
import { pointer, say } from '../support/narration';

// Market clips (NSTOCK-0390): the dashboard, search, watchlists, the stock page and its charts,
// keyboard shortcuts and the documentation page, on a 1440 × 900 desktop.

const scrollTo = async (page: Page, name: string | RegExp) => {
  await page
    .getByRole('main')
    .getByRole('region', { name })
    .first()
    .evaluate((element) => element.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  await page.waitForTimeout(900);
};

clip('dashboard', 'the dashboard with live prices', async (page) => {
  const act = pointer(page);
  await page.clock.setFixedTime(MONDAY_10_00_IST);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Good morning' })).toBeVisible();
  await expect(page.getByRole('main').locator('figure canvas').first()).toBeVisible();
  await say(page, 'The dashboard: open to everyone, no login needed. Prices are live.', 2800);
  await act.hover(page.getByRole('banner').getByText('NIFTY 50', { exact: true }).first());
  await say(
    page,
    'The header tickers and the market status update every second over the WebSocket.',
    2800,
  );
  const chart = page.getByRole('main').getByRole('region', { name: /^NIFTY 50/ });
  await say(page, 'The NIFTY 50 chart, from 1 day to 5 years.', 1200);
  for (const range of ['1D', '1W', '1M', '5Y', '1Y']) {
    await act.click(chart.getByRole('radio', { name: range, exact: true }), 900);
  }
  const box = await chart.locator('canvas').first().boundingBox();
  if (!box) throw new Error('the NIFTY 50 chart has no box');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5, { steps: 10 });
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 30 });
  await say(page, 'Hover for the crosshair and the price at that time.', 2000);
  await scrollTo(page, 'Market indices');
  await say(page, 'Market indices with ▲ ▼ and a sign: colour is never the only signal.', 2800);
  await scrollTo(page, 'Stocks lists');
  await say(page, 'Curated stock lists beside the top gainers and losers.', 2000);
  const movers = page.getByRole('main').getByRole('region', { name: 'Market movers' });
  await act.click(movers.getByRole('tab', { name: 'Top losers' }), 1200);
  await act.click(movers.getByRole('radio', { name: 'Bank' }), 1200);
  await say(page, 'Gainers or losers, by index: NIFTY 50, NIFTY Bank and NIFTY IT.', 1800);
  await act.click(page.getByRole('main').locator('a[href^="/stocks/"]').first(), 1200);
  await say(page, 'Every stock opens its own page.', 2400);
});

clip('search', 'search 5,000 stocks by symbol or name', async (page) => {
  const act = pointer(page);
  await page.goto('/dashboard');
  await page.getByRole('heading', { level: 1 }).waitFor();
  const rail = page.getByRole('complementary', { name: 'Watchlist and search' });
  const search = rail.getByRole('combobox', { name: 'Search stocks' });
  await say(page, 'Search about 5,000 NSE and BSE stocks. Press / anywhere to start.', 2400);
  await act.press('/');
  await expect(search).toBeFocused();
  await act.keys('infy', 600);
  await say(page, 'Matches by symbol or company name, with the match highlighted.', 2400);
  await act.press('ArrowDown', 400);
  await act.press('Enter', 1200);
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  await say(page, '↓ and Enter open the stock.', 1800);
  await act.click(search, 600);
  await say(page, 'An empty box shows your recent searches, then popular ones.', 2600);
  await act.type(search, 'bank', 600);
  await say(page, 'Search by name works too: "bank".', 2200);
  await act.click(rail.getByRole('option').first(), 1200);
  await say(page, '', 1200);
});

clip('watchlists', 'watchlists: create, add, reorder, sort and remove', async (page) => {
  const act = pointer(page);
  await page.clock.setFixedTime(MONDAY_10_00_IST);
  await page.goto('/login?redirect=%2Fdashboard');
  await logInOnScreen(page, freshMobile());
  await expect(page).toHaveURL(/\/dashboard$/);
  const rail = page.getByRole('complementary', { name: 'Watchlist and search' });
  await say(page, 'Watchlists live in the rail on every page.', 2000);
  await act.click(rail.getByRole('button', { name: 'New watchlist' }));
  await act.keys('Tech');
  await act.press('Enter', 900);
  await expect(rail.getByRole('tab', { name: 'Tech' })).toHaveAttribute('aria-selected', 'true');
  await say(page, 'A new list, "Tech". Add stocks from search: + or Shift+Enter.', 2200);
  const search = rail.getByRole('combobox', { name: 'Search stocks' });
  for (const symbol of ['INFY', 'TCS', 'WIPRO']) {
    await act.type(search, symbol.toLowerCase(), 500);
    await expect(rail.getByRole('option').first()).toContainText(symbol);
    await act.click(rail.locator(`[data-add-to-watchlist="${symbol}"]`), 700);
  }
  await act.press('Escape', 800);
  const rows = rail.getByRole('list', { name: 'Stocks in Tech' });
  await expect(rows.getByRole('listitem')).toHaveCount(3);
  await say(page, 'Live prices on every row, with ▲ ▼ and the day change.', 2400);

  const last = rows.getByRole('listitem').last();
  await act.hover(last);
  const handle = rail.locator('[data-drag-handle="WIPRO"]');
  const box = await handle.boundingBox();
  if (box) {
    await say(page, 'Drag a row by its handle to reorder.', 1200);
    await act.drag(
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: box.x + box.width / 2, y: box.y - 120 },
    );
  }
  await say(page, 'Or with the keyboard: Alt+↑ and Alt+↓ on a focused row.', 1400);
  await rows.getByRole('link', { name: /^TCS NSE/ }).focus();
  await act.press('Alt+ArrowDown', 900);
  await act.click(rail.getByRole('button', { name: /^Sort watchlist/ }));
  await act.click(page.getByRole('menuitemradio', { name: 'Name (A to Z)' }), 900);
  await say(page, 'Sort by name, price or change; the saved order comes back with Custom.', 2200);
  await act.click(rail.getByRole('button', { name: /^Sort watchlist/ }));
  await act.click(page.getByRole('menuitemradio', { name: 'Custom order' }), 900);
  await act.hover(rows.getByRole('listitem').filter({ hasText: 'INFY' }));
  await act.click(rail.getByRole('button', { name: 'Remove INFY' }), 900);
  await say(page, 'Remove from the row. Lists, order and sort survive a reload.', 2000);
  await page.reload();
  await expect(rows.getByRole('listitem')).toHaveCount(2);
  await say(page, 'Several lists per account, each switchable from the tabs.', 2400);
});

clip(
  'stockDetail',
  'the stock page: charts in every range and bar size, stats and depth',
  async (page) => {
    const act = pointer(page);
    await page.clock.setFixedTime(MONDAY_10_00_IST);
    await page.goto('/stocks/INFY');
    await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();
    await expect(page.locator('figure canvas').first()).toBeVisible();
    await say(
      page,
      'The stock page: live price, day change, chart, stats, depth and profile.',
      2800,
    );
    const ranges = page.getByRole('radiogroup', { name: 'Chart range' });
    const bars = page.getByRole('radiogroup', { name: 'Bar size' });
    await say(page, '1 day: 1, 5, 15, 30 and 60-minute bars.', 1200);
    for (const bar of ['5-minute', '15-minute', '30-minute', '1-hour', '1-minute']) {
      await act.click(bars.getByRole('radio', { name: `${bar} bars`, exact: true }), 1100);
    }
    await act.click(page.getByRole('radio', { name: 'Candles' }), 1200);
    await say(page, 'Candles or area, on any range.', 1600);
    for (const range of ['1W', '1M', '1Y', '5Y']) {
      await act.click(ranges.getByRole('radio', { name: range, exact: true }), 1000);
      await say(page, `${range}${range === '1W' ? ': 5, 15, 30 and 60-minute bars' : ''}`, 900);
      if (range === '1W') {
        await act.click(bars.getByRole('radio', { name: '1-hour bars', exact: true }), 1000);
      }
    }
    await say(
      page,
      'The range, type and bar size are in the URL, so a link opens the same chart.',
      2400,
    );
    const figure = page.getByRole('figure', { name: /INFY candlestick chart/ });
    const box = await figure.boundingBox();
    if (!box) throw new Error('the candlestick chart has no box');
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.45, { steps: 10 });
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.45, { steps: 30 });
    await say(page, 'The crosshair shows open, high, low and close in rupees.', 2200);
    await act.click(ranges.getByRole('radio', { name: '1D', exact: true }), 600);
    await act.click(page.getByRole('radio', { name: 'Area' }), 600);
    const stats = page.getByRole('region', { name: 'Key stats' });
    await stats.evaluate((element) =>
      element.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
    await page.waitForTimeout(900);
    await say(page, 'Key stats: day and 52-week ranges, market cap, P/E and more.', 2600);
    const depth = page.getByRole('region', { name: 'Market depth' });
    await depth.evaluate((element) =>
      element.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
    await page.waitForTimeout(900);
    await say(page, 'Live market depth: five levels of bids and asks.', 2600);
    await page.evaluate(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }),
    );
    await page.waitForTimeout(900);
    await say(page, 'And the company overview.', 2200);
  },
);

clip('keyboard', 'keyboard shortcuts: search, open, buy without a mouse', async (page) => {
  const act = pointer(page);
  await page.clock.setFixedTime(MONDAY_10_00_IST);
  await page.goto('/login?redirect=%2Fdashboard');
  await logInOnScreen(page, freshMobile());
  await expect(page).toHaveURL(/\/dashboard$/);
  await say(page, 'Everything works from the keyboard (WCAG 2.2 AA). Press ? for the list.', 2400);
  await act.press('?', 400);
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await say(page, 'The shortcuts.', 3000);
  await act.press('Escape', 600);
  await say(page, '/ to search, ↓ to pick, Shift+Enter adds to the watchlist, Enter opens.', 1400);
  await act.press('/', 300);
  await act.keys('infy', 500);
  await act.press('ArrowDown', 400);
  await act.press('Shift+Enter', 800);
  await act.press('Enter', 1200);
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  const row = page
    .getByRole('complementary', { name: 'Watchlist and search' })
    .getByRole('list', { name: 'Stocks in My Watchlist' })
    .getByRole('link', { name: /^INFY NSE/ });
  await row.focus();
  await say(page, 'On a watchlist row, B buys and S sells.', 1400);
  await act.press('b', 800);
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket).toBeVisible();
  await act.press('ControlOrMeta+a', 200);
  await act.keys('5', 400);
  await say(page, 'Type the quantity, Enter to review.', 1200);
  await act.press('Enter', 1200);
  await say(page, 'Esc closes and puts focus back where it was.', 1600);
  await act.press('Escape', 600);
  await act.press('Escape', 900);
  await expect(ticket).toBeHidden();
  await say(
    page,
    'Focus is always visible, and every change is announced to screen readers.',
    2600,
  );
});

clip('guide', 'the documentation page', async (page) => {
  const act = pointer(page);
  await page.goto('/login');
  await say(page, 'The documentation is public and linked from the login page.', 2000);
  await act.click(page.getByRole('link', { name: 'Documentation: how nthstock works' }), 1200);
  await expect(
    page.getByRole('heading', { level: 1, name: 'nthstock documentation' }),
  ).toBeVisible();
  await say(page, 'Tabs from high level to low level, each linked by URL.', 2400);
  const tabs = page.getByRole('tablist', { name: 'Documentation topics' });
  for (const name of [
    'Features',
    'Architecture',
    'Trade from Charts',
    'Scalability',
    'Walkthrough videos',
  ]) {
    const tab = tabs.getByRole('tab', { name, exact: true });
    await act.click(tab, 1400);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(1200);
    await say(page, name, 1200);
    await page.evaluate(() => window.scrollTo({ top: 0 }));
  }
  await say(page, 'Diagrams come with a text version, and every tab links to its code.', 2400);
});

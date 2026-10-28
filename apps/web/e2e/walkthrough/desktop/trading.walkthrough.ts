import { AUTH_CSRF_HEADER, TEST_CONTROL_PATHS, type TestClockRequest } from '@nthstock/contracts';
import { DEMO_SEED_USER } from '@nthstock/paperEngine';
import { expect, type Locator, type Page } from '@playwright/test';
import { clip, freshMobile, logInOnScreen, MONDAY_10_00_IST } from '../support/clip';
import { inr, pointer, rupees, say } from '../support/narration';

// Trading clips (NSTOCK-0390): the order ticket, after-market orders, the trailing stop-loss,
// Trade from Charts with a mouse, the order book, positions and portfolio, funds, and
// price alerts with notifications, on a 1440 × 900 desktop. Clips that move the price use the
// labelled Demo simulator a visitor has, from the demo account (?demo=1).

/** Logs in as the demo account (holdings, watchlists, the Demo simulator) and opens `path`. */
async function demoLogIn(page: Page, path: string) {
  await page.goto(`/login?demo=1&redirect=${encodeURIComponent(path)}`);
  await logInOnScreen(page, DEMO_SEED_USER.mobile);
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
}

async function freshLogIn(page: Page, path: string) {
  await page.goto(`/login?redirect=${encodeURIComponent(path)}`);
  await logInOnScreen(page, freshMobile());
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
}

/** Moves the page clock and the in-browser market's clock (the build's MSW test controls). */
async function setClock(page: Page, at: string) {
  await page.clock.setFixedTime(new Date(at));
  const body: TestClockRequest = { at };
  const status = await page.evaluate(
    async ({ path, body, header }) => {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [header]: 'walkthrough' },
        body: JSON.stringify(body),
      });
      return response.status;
    },
    { path: TEST_CONTROL_PATHS.clock, body, header: AUTH_CSRF_HEADER },
  );
  // 404 means a build without the MSW test controls (the recorder builds with them).
  expect(status, `POST ${TEST_CONTROL_PATHS.clock}`).toBe(200);
}

/** A price field's value in rupees; fails on an empty or zero field. */
async function priceIn(field: Locator) {
  const value = Number(await field.inputValue());
  expect(value, 'price field').toBeGreaterThan(0);
  return value;
}

const ticketOf = (page: Page, symbol: string) =>
  page.getByRole('dialog', { name: `Trade ${symbol}` });

async function marketBuy(page: Page, symbol: string, qty: string) {
  const act = pointer(page);
  await act.click(page.getByRole('button', { name: `Buy ${symbol}` }).first());
  const ticket = ticketOf(page, symbol);
  await expect(ticket).toBeVisible();
  await act.type(ticket.getByRole('textbox', { name: 'Quantity' }), qty);
  await act.click(ticket.getByRole('button', { name: `Buy ${symbol}` }));
  await act.click(ticket.getByRole('button', { name: 'Confirm' }));
  await expect(ticket).toBeHidden();
}

const nav = (page: Page, name: string) =>
  page.getByRole('banner').getByRole('link', { name, exact: true });

async function tapUntil(
  act: ReturnType<typeof pointer>,
  button: Locator,
  done: () => Promise<boolean>,
  times = 6,
) {
  for (let attempt = 0; attempt < times && !(await done()); attempt += 1) {
    await act.click(button, 1400);
  }
  // The caption that follows describes the result, so it must have happened.
  if (!(await done())) throw new Error(`no result after ${String(times)} taps`);
}

clip(
  'orderTicket',
  'the order ticket: market and limit, review, depth and circuit bands',
  async (page) => {
    const act = pointer(page);
    await page.clock.setFixedTime(MONDAY_10_00_IST);
    await page.goto('/stocks/INFY');
    await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();
    await say(
      page,
      'Paper trading with ₹10,00,000 of virtual cash. Buy asks you to log in first.',
      2400,
    );
    await act.click(page.getByRole('button', { name: 'Buy INFY' }));
    await logInOnScreen(page, freshMobile());
    const ticket = ticketOf(page, 'INFY');
    await expect(ticket).toBeVisible();
    await say(
      page,
      'Back on the stock with the ticket open. The chart stays in view beside it.',
      2600,
    );
    await say(page, 'Delivery or Intraday; Market or Limit. Market fills at the live price.', 2400);
    await act.type(ticket.getByRole('textbox', { name: 'Quantity' }), '10');
    await say(page, 'The required amount and available cash update as you type.', 2200);
    await act.click(ticket.getByRole('button', { name: 'Buy INFY' }));
    await expect(ticket.getByRole('heading', { name: 'Review your order' })).toBeVisible();
    await say(page, 'A review step before anything is sent.', 1800);
    await act.click(ticket.getByRole('button', { name: 'Confirm' }));
    await expect(
      page.getByRole('status').filter({ hasText: 'Order executed' }).first(),
    ).toBeVisible();
    await say(page, 'Executed at the market price, with a link to the order book.', 2400);

    await act.click(page.getByRole('button', { name: 'Buy INFY' }));
    await expect(ticket).toBeVisible();
    await act.click(ticket.getByRole('radio', { name: 'Intraday' }), 500);
    await act.click(ticket.getByRole('radio', { name: 'Limit' }), 500);
    await say(page, 'A limit order: type a price, or pick one from the market depth.', 1800);
    const pick = ticket.getByRole('button', { name: /use as limit price$/ });
    await act.click(pick.nth(3), 900);
    const price = ticket.getByRole('textbox', { name: 'Price (₹)' });
    const picked = await priceIn(price);
    await act.type(price, (Math.round(picked * 1.3 * 20) / 20).toFixed(2), 900);
    await act.click(ticket.getByRole('button', { name: 'Buy INFY' }), 900);
    await say(
      page,
      'Market rules: prices must sit inside the ±20% circuit band, on a 5-paise tick.',
      3000,
    );
    await act.type(price, (Math.floor(picked * 0.97 * 20) / 20).toFixed(2), 600);
    await act.type(ticket.getByRole('textbox', { name: 'Quantity' }), '3');
    await act.click(ticket.getByRole('button', { name: 'Buy INFY' }));
    await act.click(ticket.getByRole('button', { name: 'Confirm' }));
    await expect(
      page.getByRole('status').filter({ hasText: 'Order placed' }).first(),
    ).toBeVisible();
    await say(page, 'Below the market, so it rests on the book until the price comes down.', 2800);
  },
);

clip(
  'afterMarketOrder',
  'an after-market order (AMO) released at 9:15 the next morning',
  async (page) => {
    const act = pointer(page);
    await page.clock.setFixedTime(new Date('2026-09-28T14:30:00.000Z'));
    await freshLogIn(page, '/stocks/INFY');
    await say(
      page,
      'Monday, 8 PM IST: NSE is closed. Orders now go in as after-market orders.',
      2800,
    );
    await act.click(page.getByRole('button', { name: 'Buy INFY' }));
    const ticket = ticketOf(page, 'INFY');
    await expect(ticket).toBeVisible();
    await act.type(ticket.getByRole('textbox', { name: 'Quantity' }), '2');
    await act.click(ticket.getByRole('button', { name: /^(Buy INFY|Place AMO)$/ }));
    await say(page, 'The review says when it goes to the exchange: 9:15 AM.', 2200);
    await act.click(ticket.getByRole('button', { name: /^Confirm( AMO)?$/ }));
    await expect(page.getByRole('status').filter({ hasText: 'AMO placed' }).first()).toBeVisible();
    await say(page, 'AMO placed.', 1600);
    await act.click(nav(page, 'Orders'), 1000);
    const open = page.getByRole('table', { name: 'Open orders' }).getByRole('row').nth(1);
    await expect(open).toContainText('AMO');
    await say(page, 'It waits under Open, marked AMO, with nothing filled.', 2600);
    await say(page, 'Overnight to Tuesday 9:15 AM…', 1400);
    await setClock(page, '2026-09-29T03:45:30.000Z');
    await expect(page.getByRole('tab', { name: 'Open (0)' })).toBeVisible({ timeout: 20_000 });
    await act.click(page.getByRole('tab', { name: 'Executed (1)' }), 1200);
    await say(page, 'Released at the open and executed at the market price, live.', 3000);
  },
);

clip('trailingStop', 'a trailing stop-loss that ratchets up and triggers once', async (page) => {
  const act = pointer(page);
  await page.clock.setFixedTime(MONDAY_10_00_IST);
  await demoLogIn(page, '/stocks/INFY');
  const simulator = page.getByRole('region', { name: 'Demo simulator' });
  await expect(simulator).toBeVisible();
  await say(
    page,
    'Trailing stop-loss (TSLO): a stop that follows the price up and never back.',
    2600,
  );
  await marketBuy(page, 'INFY', '5');
  await say(page, 'Bought 5 INFY. With a position, the ticket offers Trailing stop.', 2200);
  await act.click(page.getByRole('button', { name: 'Sell INFY' }).first());
  const ticket = ticketOf(page, 'INFY');
  await act.click(ticket.getByRole('radio', { name: 'Trailing stop' }));
  await say(
    page,
    'Trail in rupees or percent, an optional activation price, a market or limit exit.',
    3000,
  );
  await act.click(ticket.getByRole('radio', { name: '%' }), 400);
  await act.type(ticket.getByRole('textbox', { name: 'Trail (%)' }), '1');
  await say(page, 'The preview shows the first stop and the exit value.', 2400);
  await act.click(ticket.getByRole('button', { name: 'Review trailing stop' }));
  await act.click(ticket.getByRole('button', { name: 'Place trailing stop' }));
  await expect(ticket).toBeHidden();
  const figure = page.getByRole('figure', { name: /INFY area chart/ });
  const line = figure.locator('[data-testid="chart-handle"][data-tone="trailing"]');
  await expect(line).toContainText('Trailing stop');
  await figure.evaluate((element) =>
    element.scrollIntoView({ behavior: 'smooth', block: 'center' }),
  );
  await say(page, 'The amber line on the chart is the stop.', 2000);
  const placed = rupees(await line.innerText());
  await say(page, 'The Demo simulator moves the price. Rally +1%:', 1200);
  const rally = simulator.getByRole('button', { name: 'Rally +1%' });
  await tapUntil(act, rally, async () => rupees(await line.innerText()) > placed);
  await act.click(rally, 1500);
  await expect.poll(async () => rupees(await line.innerText())).toBeGreaterThan(placed);
  await say(
    page,
    `The stop ratcheted up from ${inr(placed)} to ${inr(rupees(await line.innerText()))}.`,
    2600,
  );
  await act.click(simulator.getByRole('button', { name: 'Pull back −1%' }), 1800);
  await say(page, 'A pullback: the stop holds. It never moves down.', 2200);
  await act.click(simulator.getByRole('button', { name: 'Gap −3%' }), 600);
  await expect(line).toHaveCount(0, { timeout: 15_000 });
  await say(page, 'A gap through the stop triggers it once and sells the 5 shares.', 3000);
});

clip(
  'tradeFromCharts',
  'Trade from Charts with a mouse: place, drag to modify, cancel',
  async (page) => {
    const act = pointer(page);
    await page.clock.setFixedTime(MONDAY_10_00_IST);
    await demoLogIn(page, '/stocks/INFY');
    const figure = page.getByRole('figure', { name: /INFY area chart/ });
    const gutter = figure.getByTestId('chart-gutter');
    await expect(gutter).toBeVisible();
    await figure.evaluate((element) =>
      element.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
    await say(
      page,
      'Trade from Charts: click the price axis to put a ghost order line there.',
      2400,
    );
    const lane = await gutter.boundingBox();
    if (!lane) throw new Error('no gutter');
    await act.clickAt({ x: lane.x + lane.width / 2, y: lane.y + lane.height * 0.8 });
    const ghost = figure.locator('[data-testid="chart-handle"][data-tone="ghost"]');
    await expect(ghost).toHaveText(/New order @ ₹/);
    await say(page, 'Nothing is sent yet. Drag its handle to the price you want.', 1800);
    const from = await act.centre(ghost);
    await act.drag(from, { x: from.x, y: from.y - 20 });
    await act.click(figure.getByRole('button', { name: /^Buy at ₹.*review before placing$/ }));
    const ticket = ticketOf(page, 'INFY');
    await expect(ticket).toBeVisible();
    await say(page, 'The compact ticket opens as a limit at the line price.', 1800);
    await act.type(ticket.getByRole('textbox', { name: 'Quantity' }), '3');
    await act.click(ticket.getByRole('button', { name: 'Buy INFY' }));
    await act.click(ticket.getByRole('button', { name: 'Confirm' }));
    await expect(ticket).toBeHidden();
    const line = figure.locator('[data-testid="chart-handle"][data-tone="buy"]');
    await expect(line).toContainText('Buy 3 @ ₹');
    await say(page, 'A blue line for the open order.', 1800);
    const at = await act.centre(line);
    await say(page, 'Drag it: the price follows, and one modify goes on release.', 1400);
    await act.drag(at, { x: at.x, y: at.y - 15 });
    await expect(
      page.getByRole('status').filter({ hasText: 'Order modified' }).first(),
    ).toBeVisible();
    await say(page, 'Order modified.', 1400);
    const cross = figure.getByTestId('chart-handle-action');
    await act.click(cross, 600);
    await say(page, '× asks once: "Cancel?" A second click cancels.', 1400);
    await act.click(cross, 800);
    await expect(line).toHaveCount(0);
    await say(page, 'Cancelled, and the line is gone.', 1800);
    await marketBuy(page, 'INFY', '4');
    const chip = figure.locator('[data-testid="chart-handle"][data-tone="position"]');
    await expect(chip).toBeVisible();
    await figure.evaluate((element) =>
      element.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
    await say(page, 'A position shows as a chip at the average price, with live P&L.', 2400);
    await act.click(chip);
    const sheet = page.getByRole('dialog', { name: 'Trailing stop · INFY' });
    await expect(sheet).toBeVisible();
    await say(page, 'Click it to protect the position with a trailing stop.', 1600);
    await act.click(sheet.getByRole('button', { name: 'Set trailing stop' }));
    await expect(
      figure.locator('[data-testid="chart-handle"][data-tone="trailing"]'),
    ).toBeVisible();
    await say(
      page,
      'Chart, ticket, depth and orders read one engine state, so they never disagree.',
      3000,
    );
  },
);

clip('orders', 'the order book: open, modify, cancel and the status timeline', async (page) => {
  const act = pointer(page);
  await page.clock.setFixedTime(MONDAY_10_00_IST);
  await freshLogIn(page, '/stocks/INFY');
  await marketBuy(page, 'INFY', '2');
  await act.click(page.getByRole('button', { name: 'Buy INFY' }));
  const ticket = ticketOf(page, 'INFY');
  await act.click(ticket.getByRole('radio', { name: 'Limit' }));
  const price = ticket.getByRole('textbox', { name: 'Price (₹)' });
  const ltp = await priceIn(price);
  await act.type(price, (Math.round(ltp * 0.95 * 20) / 20).toFixed(2));
  await act.type(ticket.getByRole('textbox', { name: 'Quantity' }), '5');
  await act.click(ticket.getByRole('button', { name: 'Buy INFY' }));
  await act.click(ticket.getByRole('button', { name: 'Confirm' }));
  await expect(ticket).toBeHidden();
  await act.click(nav(page, 'Orders'), 1200);
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
  await say(page, 'Orders: Open, Executed and Cancelled, updated live over the WebSocket.', 2600);
  await act.click(page.getByRole('button', { name: 'Modify BUY 5 INFY order' }));
  const modify = page.getByRole('dialog', { name: 'Modify INFY order' });
  await say(page, 'Modify an open order: only the quantity and price can change.', 2000);
  await act.type(
    modify.getByRole('textbox', { name: 'Price (₹)' }),
    (Math.round(ltp * 0.94 * 20) / 20).toFixed(2),
  );
  await act.click(modify.getByRole('button', { name: 'Review changes' }));
  await act.click(modify.getByRole('button', { name: 'Modify order' }));
  await expect(modify).toBeHidden();
  await say(page, 'Modified.', 1200);
  await act.click(page.getByRole('button', { name: 'Cancel BUY 5 INFY order' }));
  await act.click(
    page
      .getByRole('dialog', { name: 'Cancel this order?' })
      .getByRole('button', { name: 'Cancel order' }),
  );
  await expect(page.getByRole('tab', { name: 'Open (0)' })).toBeVisible();
  await act.click(page.getByRole('tab', { name: 'Executed (1)' }), 1400);
  await say(page, 'Executed: the market buy, with its fill price.', 2000);
  await act.click(page.getByRole('tab', { name: 'Cancelled (1)' }), 900);
  await act.click(page.getByRole('button', { name: 'Details of BUY 5 INFY order' }));
  await expect(page.getByRole('dialog', { name: 'INFY order' })).toBeVisible();
  await say(page, 'Every order keeps its timeline: placed, modified, cancelled, in IST.', 3000);
});

clip('positionsPortfolio', 'positions with live P&L, exit, and the portfolio', async (page) => {
  const act = pointer(page);
  await page.clock.setFixedTime(MONDAY_10_00_IST);
  await demoLogIn(page, '/portfolio');
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  await say(page, 'Portfolio: delivery holdings, valued live, with total and day P&L.', 3000);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(1500);
  const firstHolding = page.getByRole('table', { name: 'Holdings' }).getByRole('row').nth(1);
  await act.hover(firstHolding);
  await say(page, 'Each holding shows quantity, average price, LTP and P&L.', 1800);
  await page.goto('/stocks/TCS');
  await marketBuy(page, 'TCS', '3');
  await act.click(nav(page, 'Positions'), 1200);
  await expect(page.getByRole('heading', { level: 1, name: 'Positions' })).toBeVisible();
  await say(page, "Positions: today's trades with live P&L, ticking every second.", 3000);
  const exit = page.getByRole('button', { name: /^Exit TCS/ });
  await act.click(exit);
  const ticket = ticketOf(page, 'TCS');
  await expect(ticket).toBeVisible();
  await say(page, 'Exit opens a sell ticket for the whole position, at the market price.', 2000);
  await act.click(ticket.getByRole('button', { name: 'Sell TCS' }));
  await act.click(ticket.getByRole('button', { name: 'Confirm' }));
  await expect(ticket).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Order executed' }).first(),
  ).toBeVisible();
  await say(page, 'Closed, with the realised P&L.', 2400);
});

clip('funds', 'funds: virtual cash, the ledger and a reset', async (page) => {
  const act = pointer(page);
  await page.clock.setFixedTime(MONDAY_10_00_IST);
  await freshLogIn(page, '/stocks/INFY');
  await marketBuy(page, 'INFY', '2');
  await act.click(nav(page, 'Funds'), 1200);
  await expect(page.getByRole('heading', { level: 1, name: 'Funds' })).toBeVisible();
  await say(page, 'Funds: ₹10,00,000 of virtual cash, what is invested and what is free.', 2800);
  await page.getByRole('grid', { name: 'Funds ledger' }).scrollIntoViewIfNeeded();
  await say(page, 'The ledger: every block, debit and credit, in integer paise.', 2800);
  await act.click(page.getByRole('button', { name: 'Reset paper balance' }));
  const dialog = page.getByRole('dialog', { name: 'Reset your paper balance?' });
  await say(
    page,
    'Start again: the reset clears positions and holdings, behind RESET typed.',
    2600,
  );
  await act.type(dialog.getByRole('textbox', { name: 'Type RESET to confirm' }), 'RESET');
  await act.click(dialog.getByRole('button', { name: 'Reset balance' }));
  await expect(dialog).toBeHidden();
  await say(page, 'Back to ₹10,00,000.00.', 2600);
});

clip('priceAlerts', 'price alerts and the notification centre', async (page) => {
  const act = pointer(page);
  await page.clock.setFixedTime(MONDAY_10_00_IST);
  await demoLogIn(page, '/stocks/INFY');
  await say(page, 'Price alerts: the bell beside the stock name.', 1800);
  await act.click(
    page.getByRole('button', { name: /^(Set a price alert for INFY|Price alerts for INFY)/ }),
  );
  const dialog = page.getByRole('dialog', { name: 'Price alert for INFY' });
  await expect(dialog).toBeVisible();
  await act.click(dialog.getByRole('button', { name: 'Up 1 percent' }));
  await act.type(dialog.getByRole('textbox', { name: 'Note (optional)' }), 'Breakout');
  await say(page, 'Quick ±1% and ±2% levels, or any price, with a note.', 2000);
  await act.click(dialog.getByRole('button', { name: 'Set alert' }));
  await expect(dialog).toBeHidden();
  await page
    .getByRole('figure', { name: /INFY area chart/ })
    .evaluate((element) => element.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await say(page, 'The alert shows as a dotted line on the chart.', 2200);
  const simulator = page.getByRole('region', { name: 'Demo simulator' });
  const fired = page.getByText(/^INFY crossed above ₹/).first();
  await say(page, 'Rally the price through it with the Demo simulator:', 1200);
  await tapUntil(
    act,
    simulator.getByRole('button', { name: 'Rally +1%' }),
    () => fired.isVisible(),
    5,
  );
  await expect(fired).toBeVisible({ timeout: 15_000 });
  await say(page, 'A toast the moment it crosses. It fires once.', 2400);
  const bell = page.getByRole('button', { name: /^Notifications, \d+ unread$/ });
  await act.click(bell);
  const centre = page.getByRole('dialog', { name: 'Notifications' });
  await expect(centre).toBeVisible();
  await say(page, 'The notification centre: alerts, fills and trailing stops, in IST.', 2600);
  await act.click(centre.getByRole('tab', { name: 'Price alerts' }), 1200);
  await say(page, 'Price alerts, with this one marked Triggered.', 2400);
});

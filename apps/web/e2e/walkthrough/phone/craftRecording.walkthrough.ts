import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { centreOf, touchscreen, type Point, type Touch } from '../../support/touch';
import { clip, CLIPS_DIR, MONDAY_10_00_IST } from '../support/clip';
import { dot, say } from '../support/narration';
import { startScreencast } from '../support/screencast';

// The round 2 phone recording (docs/design/recordingScript.md, CR-T24), taken by script instead of
// by hand: an iPhone 16 Pro Max screen (440 × 956 at 3×, recorded at its full 1320 × 2868) from a
// cold load of the reviewer link, through the short ticket, the line drag with its loupe, the
// trailing stop, the chart tools and the offline state, back to the tradeable Home chart. Captions
// sit in the bar at the top; a dot marks each touch.

function fingers(page: Page, touch: Touch) {
  const tapAt = async (at: Point, pauseMs = 600) => {
    await dot(page, at);
    await touch.tap(at);
    await page.waitForTimeout(pauseMs);
  };
  return {
    tapAt,
    tap: async (target: Locator, pauseMs = 600) => tapAt(await centreOf(target), pauseMs),
    tapInPlace: async (target: Locator, pauseMs = 600) => {
      const box = await target.boundingBox();
      if (!box) throw new Error('no box');
      await tapAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, pauseMs);
    },
  };
}

const rupees = (text: string) => {
  const match = /₹([\d,]+\.\d\d)/.exec(text);
  if (!match?.[1]) throw new Error(`no price in "${text}"`);
  return Number(match[1].replaceAll(',', ''));
};

clip('craftRecording', 'the round 2 phone recording', async (page) => {
  const touch = await touchscreen(page);
  const finger = fingers(page, touch);
  await page.clock.setFixedTime(MONDAY_10_00_IST);
  const stopRecording = await startScreencast(page, join(CLIPS_DIR, 'craftRecording.hd.mp4'));

  // 1. Cold load of the reviewer link: signs in and opens RELIANCE with a position.
  await page.goto('/login?try=1');
  await expect(page).toHaveURL(/\/stocks\/RELIANCE$/, { timeout: 30_000 });
  const figure = page.getByRole('figure', { name: /RELIANCE .* chart/ });
  await expect(figure.getByTestId('chart-gutter')).toBeVisible();
  await say(page, 'Cold load of the reviewer link on a phone: no layout shift', 2600);

  // 2. The instrument page: price, chart and the actions in one screen.
  await say(page, 'Price, chart, position and Sell / Buy in one screen', 2600);

  // 3. The short ticket: Buy, Limit, a price under the market, the pinned button.
  const bar = page.getByRole('group', { name: 'Trade RELIANCE' });
  await finger.tapInPlace(bar.getByRole('button', { name: 'Buy RELIANCE' }));
  const ticket = page.getByRole('dialog', { name: 'Trade RELIANCE' });
  await expect(ticket).toBeVisible();
  await say(page, 'A shorter sheet; the Buy button never leaves the thumb', 1200);
  await finger.tap(
    ticket.getByRole('radiogroup', { name: 'Order type' }).getByRole('radio', { name: 'Limit' }),
  );
  const price = ticket.getByRole('textbox', { name: 'Price (₹)' });
  await expect(price).toHaveValue(/^\d+\.\d{2}$/);
  const limit = Math.round(Number(await price.inputValue()) * 0.996 * 20) / 20;
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('5');
  await price.fill(limit.toFixed(2));
  await page.waitForTimeout(1400);
  await finger.tapInPlace(ticket.getByRole('button', { name: 'Buy RELIANCE' }), 1600);
  const confirm = ticket.getByRole('button', { name: 'Confirm' });
  if (await confirm.isVisible().catch(() => false)) await finger.tapInPlace(confirm);
  await expect(ticket).toBeHidden();

  // 4. The arrival: the order lands on the chart.
  const line = figure.locator('[data-testid="chart-handle"][data-tone="buy"]');
  await expect(line).toContainText('Buy 5 @ ₹', { timeout: 15_000 });
  await say(page, 'Order placed. The new buy line arrives where it lives: on the chart', 3400);

  // 5. The drag: hold beside the line, move up a few ticks, then down past the last price.
  const host = figure.getByTestId('chart-host');
  const from = await centreOf(line);
  await page.waitForTimeout(400);
  const plot = await host.boundingBox();
  if (!plot) throw new Error('no chart');
  await say(
    page,
    'The drag owns the gesture: no crosshair, a tick you can feel, a loupe with the price',
    600,
  );
  await dot(page, from);
  const held = await touch.press(from);
  await page.waitForTimeout(450);
  let at = from;
  for (const dy of [-10, -10, -10, -10]) {
    at = { x: at.x, y: at.y + dy };
    await held.move(at, 6);
    await page.waitForTimeout(650);
  }
  for (const dy of [14, 14, 14, 14, 14, 14]) {
    at = { x: at.x, y: at.y + dy };
    await held.move(at, 6);
    await page.waitForTimeout(550);
  }
  await page.waitForTimeout(1200);
  await held.release();
  await page.waitForTimeout(2000);

  // 6. The near miss: off the line, the chart is the chart.
  await say(page, 'Off the line, the chart is the chart: a drag pans time', 400);
  const empty = { x: plot.x + plot.width * 0.6, y: plot.y + plot.height * 0.2 };
  await dot(page, empty);
  await touch.drag(empty, { x: empty.x - 140, y: empty.y }, 30);
  await page.waitForTimeout(2400);

  // 7. The trailing stop: rally twice and watch it ratchet up.
  const simulator = page.getByRole('region', { name: 'Demo simulator' });
  await finger.tap(simulator.getByRole('button', { name: 'Demo controls' }));
  const stop = figure.locator('[data-testid="chart-handle"][data-tone="trailing"]');
  await stop.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await say(page, 'A trailing stop you can see: it glides up, it never jumps', 600);
  const before = rupees(await stop.innerText());
  const rally = simulator.getByRole('button', { name: 'Rally +1%' });
  for (let i = 0; i < 3; i += 1) {
    await finger.tap(rally, 2200);
  }
  await expect.poll(async () => rupees(await stop.innerText())).toBeGreaterThan(before);
  await page.waitForTimeout(1600);

  // 8. Chart tools: an indicator, then the full-screen chart with the drawing rail.
  await say(page, "A trader's toolkit on a phone: indicators, drawings, a chart to share", 400);
  await finger.tap(page.getByRole('button', { name: /^Indicators/ }), 1200);
  await finger.tap(page.getByRole('menuitemcheckbox', { name: /Moving average 20/ }), 500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1800);
  await finger.tap(page.getByRole('button', { name: /^Draw: open the chart full screen/ }));
  const full = page.getByRole('dialog', { name: /chart/ });
  await expect(full).toBeVisible();
  await page.waitForTimeout(800);
  await finger.tap(full.getByRole('button', { name: 'Horizontal line' }));
  const fullHost = full.getByTestId('chart-host');
  const fp = await fullHost.boundingBox();
  if (!fp) throw new Error('no full-screen chart');
  await finger.tapAt({ x: fp.x + fp.width * 0.5, y: fp.y + fp.height * 0.3 }, 2800);
  await finger.tap(full.getByRole('button', { name: 'Close full screen' }), 900);

  // 9. Offline: every state designed, including the bad ones.
  await page.context().setOffline(true);
  await expect(page.getByTestId('chart-paused')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('price-stale').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await say(page, 'Offline: the price says Stale, the chart pauses, lines lock', 3600);
  await page.context().setOffline(false);
  await expect(page.getByTestId('chart-paused')).toBeHidden({ timeout: 15_000 });
  await say(page, 'Back online: it all comes back', 1600);

  // 10. Home: the first chart is tradeable too, and the Trade sheet adds to the watchlist.
  await finger.tapInPlace(page.getByRole('button', { name: 'Back', exact: true }));
  await expect(page).toHaveURL(/\/dashboard/);
  const home = page.getByRole('region', { name: 'Trade HDFCBANK from the chart' });
  await expect(home).toBeVisible({ timeout: 15_000 });
  await home.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await say(page, 'Home opens on a chart you can trade: HDFC Bank, Paytm, Reliance', 2400);
  await finger.tap(
    page.getByRole('radio', { name: 'Paytm' }).or(page.getByRole('radio', { name: /One97/ })),
    2600,
  );

  // 11. The Trade sheet adds to the watchlist without leaving it.
  await finger.tapInPlace(page.getByRole('button', { name: /^Trade: search a stock/ }), 900);
  const sheet = page.getByRole('dialog').last();
  await say(page, 'The Trade sheet searches every stock, and adds to your watchlist', 400);
  await sheet.getByRole('combobox').first().pressSequentially('PAYTM', { delay: 120 });
  await page.waitForTimeout(1200);
  await finger.tap(sheet.getByRole('button', { name: /^Add stocks to/ }), 900);
  const adder = page.getByRole('dialog').last();
  await adder.getByRole('combobox').first().pressSequentially('PAYTM', { delay: 120 });
  await page.waitForTimeout(1000);
  await finger.tap(adder.getByRole('option').first(), 2400);
  await finger.tap(adder.getByRole('button', { name: /^Close/ }), 800);
  const feed = page.getByRole('region', { name: 'Your stocks and market movers' });
  await feed.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await expect(feed.getByText('PAYTM').first()).toBeVisible();
  await say(page, 'Paytm is now in My Watchlist', 2400);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await say(page, 'nthstock · paper trading, virtual cash', 3000);
  await stopRecording();
});

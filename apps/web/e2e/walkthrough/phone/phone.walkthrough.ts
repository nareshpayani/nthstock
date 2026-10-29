import { DEMO_SEED_USER } from '@nthstock/paperEngine';
import { expect, type Page } from '@playwright/test';
import { clip, freshMobile, logInOnScreen, MONDAY_10_00_IST } from '../support/clip';
import { finger, say } from '../support/narration';

// Phone clips (NSTOCK-0390), on a 390 × 844 touch phone: the phone layout from the dashboard to a
// filled order, and the scalper pad. The Trade from Charts journeys on a phone are the T30 clip
// (demoWalkthrough.walkthrough.ts).

async function logInTo(page: Page, path: string, mobile: string, demo = false) {
  await page.goto(`/login?${demo ? 'demo=1&' : ''}redirect=${encodeURIComponent(path)}`);
  await logInOnScreen(page, mobile);
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
}

clip(
  'phoneLayout',
  'the phone app: tabs, Trade search, stock page, bottom-sheet ticket',
  async (page) => {
    const touch = finger(page);
    await page.clock.setFixedTime(MONDAY_10_00_IST);
    await logInTo(page, '/dashboard', freshMobile());
    await expect(page.getByRole('heading', { level: 1, name: 'Portfolio value' })).toBeVisible();
    await say(
      page,
      'On a phone, nthstock is a phone app: tabs at the bottom, in thumb reach.',
      2400,
    );
    await touch.scroll(500);
    await touch.scroll(500);
    await say(page, 'Watchlist, gainers and losers, indices and lists under the chart.', 1800);
    await touch.scroll(-2000);
    await touch.tap(page.getByRole('button', { name: /^Trade:/ }));
    const sheet = page.getByRole('dialog', { name: 'Trade' });
    await expect(sheet).toBeVisible();
    await say(page, 'The centre Trade button: search, then straight to the order ticket.', 2200);
    await touch.type(sheet.getByRole('combobox', { name: 'Search stocks' }), 'infy', 800);
    await touch.tap(sheet.getByRole('option').first(), 1200);
    await expect(page).toHaveURL(/\/stocks\/INFY$/);
    const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
    await expect(ticket).toBeVisible();
    await say(page, 'The stock page opens with the ticket up, a bottom sheet.', 2000);
    await touch.type(ticket.getByRole('textbox', { name: 'Quantity' }), '2');
    await touch.tap(ticket.getByRole('button', { name: 'Buy INFY' }));
    await touch.tap(ticket.getByRole('button', { name: 'Confirm' }), 1200);
    await expect(ticket).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Infosys Ltd' })).toBeVisible();
    const strip = page.getByTestId('position-strip');
    await expect(strip).toBeVisible();
    await say(page, 'Filled: the position strip shows quantity, average and live P&L.', 2400);
    await say(
      page,
      'The stock page: chart first, details in tabs, a sticky Buy and Sell bar.',
      2600,
    );
    const tabs = page.getByRole('tablist', { name: 'Stock details' });
    await touch.tap(tabs.getByRole('tab', { name: 'Depth' }), 1400);
    await say(page, 'Market depth in its own tab.', 1600);
    await touch.tap(tabs.getByRole('tab', { name: 'Orders' }), 1400);
    await say(page, "The Orders tab lists today's orders for this stock.", 2400);
  },
);

clip(
  'scalper',
  'the scalper pad on a phone: arm, one tap in, one tap out, reverse',
  async (page) => {
    const touch = finger(page);
    await page.clock.setFixedTime(MONDAY_10_00_IST);
    await logInTo(page, '/stocks/INFY', DEMO_SEED_USER.mobile, true);
    await say(page, 'Scalp mode: a one-tap pad for fast in-and-out trades.', 2000);
    const pad = page.getByRole('region', { name: 'Scalper for INFY' });
    await expect(async () => {
      if (!(await pad.isVisible()))
        await touch.tapInPlace(page.getByRole('switch', { name: 'Scalp' }));
      await expect(pad).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await page
      .getByRole('figure', { name: /INFY area chart/ })
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await touch.tapInPlace(pad.getByRole('radio', { name: '5 shares', exact: true }));
    await say(page, 'Pick a size, then Arm. Disarmed, the buttons send nothing.', 1800);
    await touch.tapInPlace(pad.getByRole('switch', { name: 'Arm' }));
    const ack = pad.getByRole('status', { name: 'Last scalp order' });
    await expect(pad.getByTestId('scalp-buy')).toContainText(/Buy at ask\s*₹[\d,]+\.\d\d/);
    await say(page, 'Buy at ask: an immediate-or-cancel limit at the price on the button.', 2000);
    const until = async (button: 'scalp-buy' | 'scalp-flatten', text: RegExp) =>
      expect(async () => {
        if (!text.test(await ack.innerText())) await touch.tapInPlace(pad.getByTestId(button), 900);
        await expect(ack).toHaveText(text, { timeout: 2000 });
      }).toPass({ timeout: 20_000 });
    await until('scalp-buy', /^Bought 5 @ ₹/);
    await say(page, 'Bought 5. The acknowledgement says exactly what happened.', 2200);
    await until('scalp-flatten', /^Closed: sold 5 @ ₹/);
    await say(page, 'Flatten closes the position in one tap.', 2000);
    await until('scalp-buy', /^Bought 5 @ ₹/);
    await say(page, 'Reverse doubles the exposure, so it is the only one that needs a hold.', 1800);
    const reverse = pad.getByTestId('scalp-reverse');
    const box = await reverse.boundingBox();
    if (!box) throw new Error('no reverse button');
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const session = await page.context().newCDPSession(page);
    const touchAt = (type: 'touchStart' | 'touchEnd') =>
      session.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: at.x, y: at.y, id: 1 }],
      });
    await touchAt('touchStart');
    await page.waitForTimeout(900);
    await touchAt('touchEnd');
    // A reverse closes, then sends an IOC entry the other way, which the price can outrun.
    await expect(ack).toHaveText(/^(Reversed|Closed, but)/, { timeout: 15_000 });
    await say(
      page,
      /^Reversed/.test(await ack.innerText())
        ? 'Reversed: now short 5. The pad disarms itself after 2 minutes idle.'
        : 'Closed, and the reverse entry was refused because the price moved: it never chases.',
      3000,
    );
  },
);

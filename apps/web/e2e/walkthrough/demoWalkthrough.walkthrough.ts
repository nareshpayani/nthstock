import { expect, type Locator, type Page } from '@playwright/test';
import { centreOf, touchscreen, type Point, type Touch } from '../support/touch';
import { clip, MONDAY_10_00_IST } from './support/clip';
import { dot, inr, rupees, say } from './support/narration';

// T30 (SPEC-TFC-1 §16, REQ-DEL-04): the demo walkthrough video, recorded from the production build
// on a 390 × 844 touch phone. It follows the shot list in docs/runbooks/demo-walkthrough.md with
// the real demo surfaces only: Try demo, the price-axis gutter, the ticket, the position chip, the
// Demo simulator and the scalper. No test controls, so it runs against the live site too.
//
// Each step shows a caption at the top of the screen and a dot where the finger lands, so the video
// reads without sound. `npm run e2e:walkthrough -w @nthstock/web` writes the .webm to
// test-results/walkthrough/clips; tools/demo/recordWalkthrough.sh turns it into
// public/demo/walkthrough.mp4. The caption and dot helpers are shared with the feature clips.

function fingers(page: Page, touch: Touch) {
  const tapAt = async (at: Point) => {
    await dot(page, at);
    await touch.tap(at);
    await page.waitForTimeout(700);
  };
  return {
    tapAt,
    tap: async (target: Locator) => tapAt(await centreOf(target)),
    /** For the sticky trade bar and pad: tapped where they are, with no scroll. */
    tapInPlace: async (target: Locator) => {
      const box = await target.boundingBox();
      if (!box) throw new Error('no box');
      await tapAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    },
    drag: async (from: Point, to: Point) => {
      await dot(page, from);
      await touch.drag(from, to, 24);
      await dot(page, to);
      await page.waitForTimeout(700);
    },
  };
}

/** Swipes the order toasts away, as a phone user would: on a phone they sit over the trade bar. */
async function clearToasts(page: Page) {
  const touch = await touchscreen(page);
  const toasts = page.getByRole('region', { name: /^Notifications/ }).locator('li');
  for (let swipes = 0; swipes < 6 && (await toasts.count()) > 0; swipes += 1) {
    const box = await toasts.first().boundingBox();
    if (!box) break;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await dot(page, at);
    await touch.drag(at, { x: at.x + 260, y: at.y }, 12);
    await page.waitForTimeout(400);
  }
}

clip('walkthrough', 'demo walkthrough on a phone (T30)', async (page) => {
  const touch = await touchscreen(page);
  const finger = fingers(page, touch);

  // A Monday morning, so the paper engine fills orders whatever day the clip is recorded on.
  await page.clock.setFixedTime(MONDAY_10_00_IST);
  // Cold load, then Try demo: one tap to the demo instrument.
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Try demo' })).toBeVisible();
  await say(page, 'nthstock: paper trading on a simulated NSE market. Tap Try demo.', 2600);
  await finger.tap(page.getByRole('button', { name: 'Try demo' }));
  await expect(page).toHaveURL(/\/stocks\/RELIANCE$/, { timeout: 20_000 });
  const figure = page.getByRole('figure', { name: /RELIANCE area chart/ });
  const gutter = figure.getByTestId('chart-gutter');
  await expect(gutter).toBeVisible();
  const simulator = page.getByRole('region', { name: 'Demo simulator' });
  await expect(simulator).toBeVisible();
  await say(
    page,
    'One tap from the login page to a live chart. The "Simulated" panel moves the price.',
    2800,
  );

  // US-01: tap the price axis a little under the price: a ghost line; drag its handle.
  await gutter.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await say(page, 'US-01 · Tap the price axis: a ghost order line appears. Nothing is sent yet.');
  const lane = await gutter.boundingBox();
  if (!lane) throw new Error('no gutter');
  await finger.tapAt({ x: lane.x + lane.width / 2, y: lane.y + lane.height * 0.7 });
  const ghost = figure.locator('[data-testid="chart-handle"][data-tone="ghost"]');
  await expect(ghost).toHaveText(/New order @ ₹/);
  await say(
    page,
    'Drag the line by its handle to the price you want. The chart does not pan.',
    1600,
  );
  const from = await centreOf(ghost);
  await finger.drag(from, { x: from.x - 20, y: from.y - 8 });
  await page.waitForTimeout(800);

  // US-02: Buy from the ghost: the compact ticket at that price, with a 1% trailing stop.
  await say(
    page,
    'US-02 · Tap Buy: the ticket opens at the line price. Add a 1% trailing stop.',
    1600,
  );
  const ticket = page.getByRole('dialog', { name: 'Trade RELIANCE' });
  await expect(async () => {
    if (!(await ticket.isVisible())) {
      await finger.tap(figure.getByRole('button', { name: /^Buy at ₹.*review before placing$/ }));
    }
    await expect(ticket).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  const limit = Number(await ticket.getByRole('textbox', { name: 'Price (₹)' }).inputValue());
  expect(limit, 'the ticket price').toBeGreaterThan(0);
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('4');
  await finger.tap(ticket.getByRole('switch', { name: 'Add trailing stop' }));
  await ticket.getByRole('textbox', { name: 'Trail (%)' }).fill('1');
  await say(
    page,
    'Quantity 4, trail 1%. The preview line says what will happen on the fill.',
    2600,
  );
  await finger.tap(ticket.getByRole('button', { name: 'Buy RELIANCE' }));
  await page.waitForTimeout(900);
  await finger.tap(ticket.getByRole('button', { name: 'Confirm' }));
  await expect(ticket).toBeHidden();
  const line = figure.locator('[data-testid="chart-handle"][data-tone="buy"]');
  const chip = figure.locator('[data-testid="chart-handle"][data-tone="position"]');
  const pullBack = simulator.getByRole('button', { name: 'Pull back −1%' });
  // The random walk can touch a limit close under the price at once; then there is no line to show.
  await expect(line.or(chip).first()).toBeVisible();
  if (await line.isVisible()) {
    await expect(line).toContainText('Buy 4 @ ₹');
    await say(page, `A blue buy line at ${inr(limit)}. The stop arms when the entry fills.`, 2400);

    // The price comes down to the limit: Pull back until the entry fills.
    await say(page, 'Pull the simulated price back until the buy fills.', 1200);
    for (let attempt = 0; attempt < 6 && (await chip.count()) === 0; attempt += 1) {
      await finger.tap(pullBack);
      await page.waitForTimeout(1200);
    }
  }
  await expect(chip).toHaveText(/\+4 @ ₹/, { timeout: 15_000 });
  const stop = figure.locator('[data-testid="chart-handle"][data-tone="trailing"]');
  await expect(stop).toContainText('Trailing SL', { timeout: 15_000 });
  await chip.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await say(
    page,
    'Filled. The position chip shows live P&L; the amber line is the trailing stop.',
    2800,
  );

  // US-03: tap the chip: the trailing-stop sheet for the position. Widen the trail to 1.5%.
  await say(page, 'US-03 · Tap the position: its trailing-stop sheet opens.', 1200);
  await finger.tap(chip);
  const sheet = page.getByRole('dialog', { name: 'Trailing stop · RELIANCE' });
  const update = sheet.getByRole('button', { name: 'Update trailing stop' });
  await expect(update).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Trail (%)' }).fill('1.5');
  await say(page, 'Change the trail to 1.5% and update. One modify, no cancel and replace.', 2200);
  await finger.tap(update);
  await expect(sheet).toBeHidden();
  await expect(stop).toContainText('1.5%', { timeout: 10_000 });

  // US-04: rally twice, the stop ratchets up; pull back, it holds; gap down, it triggers once.
  await stop.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await say(page, 'US-04 · Rally the price: the stop follows new highs.', 1200);
  const placed = rupees(await stop.innerText());
  const rally = simulator.getByRole('button', { name: 'Rally +1%' });
  for (let attempt = 0; attempt < 4 && rupees(await stop.innerText()) <= placed; attempt += 1) {
    await finger.tap(rally);
    await page.waitForTimeout(1500);
  }
  await finger.tap(rally);
  await page.waitForTimeout(1500);
  await expect.poll(async () => rupees(await stop.innerText())).toBeGreaterThan(placed);
  await say(
    page,
    `The stop moved up from ${inr(placed)} to ${inr(rupees(await stop.innerText()))}.`,
    2400,
  );
  const raised = rupees(await stop.innerText());
  await say(page, 'Pull back: the stop never moves down.', 1000);
  await finger.tap(pullBack);
  await page.waitForTimeout(1800);
  expect(rupees(await stop.innerText())).toBeGreaterThanOrEqual(raised);
  await say(page, 'Gap down 3% through the stop: it triggers once and sells the 4 shares.', 1400);
  await finger.tap(simulator.getByRole('button', { name: 'Gap −3%' }));
  await expect(chip).toHaveCount(0, { timeout: 15_000 });
  await expect(stop).toHaveCount(0);
  await say(page, 'Trailing stop triggered. Position and line are gone.', 2600);

  // US-05: the scalper. Arm, buy at the ask in one tap, flatten in one tap.
  await say(page, 'US-05 · Scalp mode: pick a size, arm, then one tap in and one tap out.', 1400);
  const pad = page.getByRole('region', { name: 'Scalper for RELIANCE' });
  await clearToasts(page);
  await expect(async () => {
    if (!(await pad.isVisible()))
      await finger.tapInPlace(page.getByRole('switch', { name: 'Scalp' }));
    await expect(pad).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  // The pad is sticky at the bottom: bring the chart back above it.
  await figure.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await finger.tapInPlace(pad.getByRole('radio', { name: '5 shares', exact: true }));
  await finger.tapInPlace(pad.getByRole('switch', { name: 'Arm' }));
  const buy = pad.getByTestId('scalp-buy');
  await expect(buy).toContainText(/Buy at ask\s*₹[\d,]+\.\d\d/);
  await finger.tapInPlace(buy);
  const ack = pad.getByRole('status', { name: 'Last scalp order' });
  await expect(ack).toHaveText(/^Bought 5 @ ₹/, { timeout: 10_000 });
  await say(page, 'Bought 5 at the ask. The strip shows the open position.', 2400);
  await clearToasts(page);
  // Tap again if the first tap landed while a toast was still sliding away.
  await expect(async () => {
    if (!/^Closed/.test(await ack.innerText()))
      await finger.tapInPlace(pad.getByTestId('scalp-flatten'));
    await expect(ack).toHaveText(/^Closed: sold 5 @ ₹/, { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await say(page, 'Flatten: closed in one tap. Trading is only live while armed.', 2400);

  await clearToasts(page);
  await say(
    page,
    'Every surface reads one engine state: chart, ticket, depth and strip never disagree.',
    3200,
  );
});

import { TICK_SIZE_PAISE } from '@nthstock/contracts';
import { expect, test } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { API_TAG } from './support/env';
import { MONDAY_10_00_IST, inr, scriptedPrices, setClock, setPrice } from './support/testControls';

// NSTOCK-0368 (SPEC-TFC-1 §6.3, acceptance criterion 4): set a trailing stop from the position
// chip, ratchet it with scripted ticks, and trigger it, in msw mode and (tagged @api) against
// apps/api, which keeps the stop in Postgres, and apps/realtime, which relays its changes as
// `accountDelta` frames. Prices come from the test controls, never from the random walk.

const onTick = (paise: number) => Math.round(paise / TICK_SIZE_PAISE) * TICK_SIZE_PAISE;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rupeesIn = (text: string) => {
  const match = /₹([\d,]+\.\d\d)/.exec(text);
  if (!match?.[1]) throw new Error(`no price in "${text}"`);
  return Math.round(Number(match[1].replaceAll(',', '')) * 100);
};

test(`a trailing stop ratchets with scripted ticks and closes the position when hit ${API_TAG}`, async ({
  page,
}) => {
  test.setTimeout(150_000);
  await setClock(page, MONDAY_10_00_IST);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login?redirect=%2Fstocks%2FINFY');
  await logIn(page, uniqueMobile());
  await expect(page).toHaveURL(/\/stocks\/INFY$/);
  const { base } = await scriptedPrices(page, 'INFY');
  await setPrice(page, 'INFY', base);
  const figure = page.getByRole('figure', { name: /INFY area chart/ });
  await expect(figure.getByTestId('chart-gutter')).toBeVisible();

  // Buy 5 at market, then set a 2% trailing stop from the position chip.
  await page.getByRole('main').getByRole('button', { name: 'Buy INFY' }).click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await ticket.getByRole('textbox', { name: 'Quantity' }).fill('5');
  await ticket.getByRole('button', { name: 'Buy INFY' }).click();
  await ticket.getByRole('button', { name: 'Confirm' }).click();
  await expect(ticket).toBeHidden();
  const chip = figure.locator('[data-testid="chart-handle"][data-tone="position"]');
  await expect(chip).toHaveText(/\+5 @ /);
  await chip.click();
  const sheet = page.getByRole('dialog', { name: 'Trailing stop · INFY' });
  await sheet.getByRole('textbox', { name: 'Trail (%)' }).fill('2');
  await sheet.getByRole('button', { name: 'Set trailing stop' }).click();
  await expect(sheet).toBeHidden();
  const line = figure.locator('[data-testid="chart-handle"][data-tone="trailing"]');
  await expect(line).toHaveText(/Trailing stop ₹[\d,]+\.\d\d · 2% · Trailing$/);
  const placed = rupeesIn(await line.innerText());
  expect(placed).toBeLessThan(base);

  // A rally of 3% raises the stop, live, with no reload.
  const high = onTick(base * 1.03);
  await setPrice(page, 'INFY', high);
  await expect
    .poll(async () => rupeesIn(await line.innerText()), { timeout: 15_000 })
    .toBeGreaterThan(placed);
  const raised = rupeesIn(await line.innerText());

  // A pullback that stays above the stop leaves it where it is: the backend's own copy, read
  // after the tick (a read syncs the engine first), and the line both keep the raised stop.
  await setPrice(page, 'INFY', raised + 2 * TICK_SIZE_PAISE);
  const stops = (await page.evaluate(async () => {
    const response = await fetch('/v1/trailing-stops', { credentials: 'include' });
    return (await response.json()) as { items: { stopPrice: number | null; status: string }[] };
  })) as { items: { stopPrice: number | null; status: string }[] };
  expect(stops.items[0]).toMatchObject({ status: 'TRAILING', stopPrice: raised });
  await expect(line).toHaveText(new RegExp(`Trailing stop ${escape(inr(raised))} `));

  // Through the stop: the market exit sells the 5 and the stop ends Executed.
  await setPrice(page, 'INFY', raised - TICK_SIZE_PAISE);
  await expect(chip).toBeHidden({ timeout: 15_000 });
  await page.getByRole('link', { name: 'Orders', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
  await page.getByRole('tab', { name: /^Executed/ }).click();
  const executed = page.getByRole('table', { name: 'Executed orders' });
  await expect(executed.getByRole('row').filter({ hasText: 'SELL' }).first()).toContainText(
    inr(raised - TICK_SIZE_PAISE),
  );
});

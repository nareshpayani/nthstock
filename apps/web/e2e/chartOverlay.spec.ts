import { expect, test, type Locator, type Page } from '@playwright/test';

// T15 (SPEC-TFC-1 §8.2, §9.1, §10.5, REQ-TFC-01, REQ-MOB-03): the trading overlay on the real
// chart. Tapping the price gutter puts a ghost line at that price, its handle sits on the line,
// and dragging the handle moves the price. A zoom on the plot keeps the ghost at its price.
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('element has no box');
  return rect;
}

const priceOf = async (handle: Locator) => {
  const match = /₹([\d,]+\.\d\d)/.exec(await handle.innerText());
  if (!match?.[1]) throw new Error('no price on the handle');
  return Number(match[1].replaceAll(',', ''));
};

async function openChart(page: Page) {
  await page.goto('/stocks/INFY');
  const figure = page.getByRole('figure', { name: /INFY area chart/ });
  await expect(figure.locator('canvas').first()).toBeVisible();
  const gutter = figure.getByTestId('chart-gutter');
  await expect(gutter).toBeVisible();
  return { figure, gutter };
}

for (const viewport of VIEWPORTS) {
  test(`gutter tap, ghost handle and drag on the ${viewport.name} chart (T15)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const { figure, gutter } = await openChart(page);

    const lane = await box(gutter);
    expect(lane.width).toBeGreaterThanOrEqual(64);
    await expect(gutter).toHaveCSS('touch-action', 'none');

    const tapY = lane.y + lane.height * 0.4;
    await page.mouse.click(lane.x + lane.width / 2, tapY);
    const ghost = figure.getByRole('button', { name: /^New order at ₹/ });
    await expect(ghost).toHaveText(/New order @ ₹[\d,]+\.\d\d/);
    // The handle is centred on the line drawn at the tapped price (snapped to ₹0.05).
    const placed = await box(ghost);
    expect(Math.abs(placed.y + placed.height / 2 - tapY)).toBeLessThanOrEqual(3);
    expect(placed.height).toBeGreaterThanOrEqual(44);
    const tapped = await priceOf(ghost);

    // Zooming time rescales prices; the ghost stays at its price and inside the pane.
    const plot = await box(figure.getByTestId('chart-host'));
    await page.mouse.move(plot.x + plot.width / 3, plot.y + plot.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(() => priceOf(ghost)).toBe(tapped);
    const zoomed = await box(ghost);
    expect(zoomed.y).toBeGreaterThanOrEqual(lane.y - 1);
    expect(zoomed.y + zoomed.height).toBeLessThanOrEqual(lane.y + lane.height + 1);

    // Dragging the handle down lowers the price; it is kept on release.
    const from = await box(ghost);
    const startY = from.y + from.height / 2;
    await page.mouse.move(from.x + from.width / 2, startY);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, startY + 20, { steps: 4 });
    await page.mouse.move(from.x + from.width / 2, startY + 40, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => priceOf(ghost)).toBeLessThan(tapped);

    // Delete removes the ghost; no sideways scroll at any width.
    await ghost.focus();
    await page.keyboard.press('Delete');
    await expect(ghost).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

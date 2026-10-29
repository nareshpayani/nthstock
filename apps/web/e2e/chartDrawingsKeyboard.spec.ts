import { expect, test, type Locator } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/axe';

// NSTOCK-0468: place chart drawings with the keyboard alone (WCAG 2.1.1). On the full-screen chart,
// pick the trend line on the rail, Tab to the plot, move the point with the arrows and place both
// ends with Enter, then remove the line from the rail's drawings list. axe checks the dialog.

/** Focuses `target` and presses `key` on it, as Tab and a key press would. */
async function press(target: Locator, key: string) {
  await target.focus();
  await expect(target).toBeFocused();
  await target.page().keyboard.press(key);
}

test('keyboard only: draw a trend line on the full-screen chart and remove it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/stocks/INFY');
  await press(page.getByRole('button', { name: 'Open the chart full screen' }), 'Enter');
  const dialog = page.getByRole('dialog', { name: 'INFY chart' });
  await expect(dialog).toBeVisible();
  const rail = dialog.getByRole('toolbar', { name: 'Drawing tools' });

  await press(rail.getByRole('button', { name: 'Trend line' }), 'Enter');
  const plot = dialog.getByRole('application', { name: 'Chart plot: Trend line' });
  await expect(plot).toHaveAccessibleDescription(/Arrow keys move the point/);
  await expectNoSeriousA11yViolations(
    page,
    'full-screen chart with a tool picked',
    '[role="dialog"]',
  );

  const readout = dialog.getByTestId('keyboard-readout');
  await press(plot, 'Shift+ArrowLeft');
  await expect(readout).toContainText('₹');
  await page.keyboard.press('Enter');
  await expect(readout).toContainText('Start placed at');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Enter');
  await expect(readout).toHaveText('Trend line placed');
  await expect(rail.getByRole('button', { name: /^Crosshair/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const list = rail.getByRole('button', { name: 'Drawings on this chart (1)' });
  await press(list, 'Enter');
  const item = page.getByRole('menuitem', { name: /^Remove Trend line, ₹[\d,.]+ to ₹[\d,.]+$/ });
  await expect(item).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rail.getByRole('button', { name: 'Drawings on this chart (0)' })).toBeDisabled();
  await expectNoSeriousA11yViolations(page, 'full-screen chart after drawing', '[role="dialog"]');
});

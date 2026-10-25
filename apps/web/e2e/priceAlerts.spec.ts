import { expect, test } from '@playwright/test';
import { logIn } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';
import { MONDAY_10_00_IST, scriptedPrices, setClock, setPrice } from './support/testControls';

// NSTOCK-0344: set a price alert from the stock page, see it fire as a toast the moment the price
// crosses it, then find it in the notification centre with its alert marked Triggered.
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`price alert fires and lands in the notification centre on ${viewport.name}`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await setClock(page, MONDAY_10_00_IST);
    await page.goto('/login?redirect=%2Fstocks%2FINFY');
    await logIn(page);
    await expect(page).toHaveURL(/\/stocks\/INFY$/);

    await page.getByRole('button', { name: 'Set a price alert for INFY' }).click();
    const dialog = page.getByRole('dialog', { name: 'Price alert for INFY' });
    await expect(dialog.getByText(/^Now ₹/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Up 2 percent' }).click();
    await expect(
      dialog.getByText(/^Alert when INFY rises to ₹[\d,]+\.\d\d or above\.$/),
    ).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Note (optional)' }).fill('Breakout');
    await dialog.getByRole('button', { name: 'Set alert' }).click();
    // Setting an alert closes the dialog with a toast.
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/^Alert set: INFY at ₹/)).toBeVisible();
    const bellButton = page.getByRole('button', { name: 'Price alerts for INFY, 1 active' });
    await expect(bellButton).toBeVisible();
    // Reopened, it lists the alert under the form, ready for another.
    await bellButton.click();
    await expect(dialog.getByRole('region', { name: 'Active alerts' })).toContainText('Breakout');
    await expectNoSeriousA11yViolations(page, 'price alert dialog', '[role="dialog"]');
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(dialog).toBeHidden();

    // The price jumps past the level: a toast at once, and the bell counts it.
    const { base } = await scriptedPrices(page, 'INFY');
    await setPrice(page, 'INFY', base + Math.round(base * 0.1) - (Math.round(base * 0.1) % 5));
    await expect(page.getByText(/^INFY crossed above ₹/).first()).toBeVisible();
    const bell = page.getByRole('button', { name: /^Notifications, \d+ unread$/ });
    await expect(bell).toBeVisible();

    await bell.click();
    const centre = page.getByRole('dialog', { name: 'Notifications' });
    await expect(
      centre.getByRole('link', { name: /INFY crossed above ₹.*Breakout/ }),
    ).toBeVisible();
    await centre.getByRole('tab', { name: 'Price alerts' }).click();
    await expect(centre.getByText('Triggered')).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'notification centre', '[role="dialog"]');

    // Opening the centre marked everything read.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  });
}

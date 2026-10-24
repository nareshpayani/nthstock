import { DEV_OTP } from '@nthstock/contracts';
import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/axe';

// NSTOCK-0226: the demo user has two other sessions in the mock (a trusted phone and a laptop).
// Settings, Security lists all three with this browser marked, and logs the laptop out behind a
// confirm and a PIN step-up, then the rest with Log out all other devices.
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

const DEMO_MOBILE = '9000000001';
const PIN = '4821';

async function typeInto(page: Page, group: string, code: string) {
  const first = page.getByRole('group', { name: group }).getByRole('textbox').first();
  await expect(first).toBeVisible();
  await first.focus();
  await page.keyboard.type(code);
}

for (const viewport of VIEWPORTS) {
  test(`active sessions: log out other devices on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/login?redirect=%2Fsettings%2Fsecurity');
    await page.getByRole('textbox', { name: 'Mobile number' }).fill(DEMO_MOBILE);
    await page.getByRole('checkbox', { name: /I agree/ }).check();
    await page.getByRole('button', { name: 'Get OTP' }).click();
    await typeInto(page, 'One-time password', DEV_OTP);
    // Set a PIN, so the step-up below takes the PIN.
    await typeInto(page, 'New PIN', PIN);
    await typeInto(page, 'Confirm PIN', PIN);
    await page.getByRole('button', { name: 'Set PIN' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();

    const list = page.getByRole('list', { name: 'Where you are logged in' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    const current = list.getByRole('listitem').filter({ hasText: 'This device' });
    await expect(current).toHaveCount(1);
    await expect(current.getByRole('button', { name: /^Log out/ })).toHaveCount(0);
    await expect(list.getByText('Safari on iOS')).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'active sessions');

    await page.getByRole('button', { name: 'Log out Chrome on Windows' }).click();
    const confirm = page.getByRole('dialog', { name: 'Log out this device?' });
    await confirm.getByRole('button', { name: 'Log out' }).click();
    const stepUp = page.getByRole('dialog', { name: 'Confirm it is you' });
    await expect(stepUp).toBeVisible();
    await typeInto(page, 'Your PIN', PIN);
    await stepUp.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Chrome on Windows is logged out').first()).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(2);

    // Still stepped up: no second ask.
    await page.getByRole('button', { name: 'Log out all other devices' }).click();
    await page
      .getByRole('dialog', { name: 'Log out all other devices?' })
      .getByRole('button', { name: 'Log out all other devices' })
      .click();
    await expect(page.getByText('1 other device logged out').first()).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByText('You are logged in only on this device.')).toBeVisible();
  });
}

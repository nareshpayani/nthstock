import { DEV_OTP } from '@nthstock/contracts';
import { base32Decode, totpCode } from '@nthstock/utils';
import { expect, test, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';

// NSTOCK-0219 to NSTOCK-0221: turn on two-factor from Security settings behind a step-up (scan the
// QR code or type the setup key, confirm with the app's code, save the recovery codes), then log
// out and back in, where the code step follows the OTP. The test plays the authenticator app with
// the same RFC 6238 code as the backends.
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;

async function typeInto(page: Page, group: string, code: string) {
  const first = page.getByRole('group', { name: group }).getByRole('textbox').first();
  await expect(first).toBeVisible();
  await first.focus();
  await page.keyboard.type(code);
}

for (const viewport of VIEWPORTS) {
  test(`two-factor turns on and guards the next login on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(viewport);
    const mobile = uniqueMobile();
    await page.goto('/login?redirect=%2Fsettings%2Fsecurity');
    await logIn(page, mobile);
    await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();
    await expect(page.getByLabel('Two-factor authentication is off')).toBeVisible();

    // Step-up: no PIN on this account, so an OTP to the user's own mobile.
    await page.getByRole('button', { name: 'Turn on' }).click();
    const stepUp = page.getByRole('dialog', { name: 'Confirm it is you' });
    // The login OTP's resend throttle covers a step-up OTP to the same mobile.
    await page.waitForTimeout(31_000);
    await stepUp.getByRole('button', { name: 'Send OTP' }).click();
    await typeInto(page, 'One-time password', DEV_OTP);
    await stepUp.getByRole('button', { name: 'Confirm' }).click();

    const setup = page.getByRole('dialog', { name: 'Turn on two-factor authentication' });
    await expect(
      setup.getByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'two-factor setup', '[role="dialog"]');
    const key = (await setup.getByTestId('totp-setup-key').textContent()) ?? '';
    const secret = base32Decode(key);
    await setup.getByRole('button', { name: 'Next' }).click();
    await typeInto(page, 'Code from your authenticator app', await totpCode(secret, Date.now()));

    const codeItems = setup.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem');
    await expect(codeItems).toHaveCount(10);
    const codes = await codeItems.allTextContents();
    await setup.getByRole('checkbox', { name: 'I have saved these codes' }).check();
    await setup.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByLabel('Two-factor authentication is on')).toBeVisible();
    await expect(page.getByText('Two-factor authentication is on', { exact: true })).toBeVisible();

    // Log out and back in: after the OTP comes the code step. A recovery code works once.
    if (viewport.name === 'phone') {
      // The phone has no profile menu: Log out sits on the Account tab (NSTOCK-0466).
      const tabBar = page.getByRole('navigation', { name: 'Main' }).last();
      await tabBar.getByRole('link', { name: 'Account', exact: true }).click();
      await page.getByRole('button', { name: 'Log out' }).click();
    } else {
      await page.getByRole('button', { name: /account: /i }).click();
      await page.getByRole('menuitem', { name: 'Log out' }).click();
    }
    await expect(page).toHaveURL(/\/login/);
    await page.waitForTimeout(31_000); // the OTP resend throttle
    const field = page.getByRole('textbox', { name: 'Mobile number' });
    await field.fill(mobile);
    await page.getByRole('checkbox', { name: /I agree/ }).check();
    await page.getByRole('button', { name: 'Get OTP' }).click();
    await typeInto(page, 'One-time password', DEV_OTP);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Two-factor authentication' }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'login code step');

    await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
    await page.getByRole('textbox', { name: 'Recovery code' }).fill(codes[0] ?? '');
    await page.getByRole('button', { name: 'Verify' }).click();
    // Then the usual offer of a PIN, as after any OTP login without one.
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
}

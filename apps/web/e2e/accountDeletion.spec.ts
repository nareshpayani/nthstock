import { DEV_OTP } from '@nthstock/contracts';
import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/axe';

// NSTOCK-0233/0234 (DPDP Act 2023): Settings, Security deletes the account behind DELETE typed and
// a PIN step-up; the app lands on /login with the notice, and an OTP login for the same mobile
// then says when its data is erased instead of signing up again.
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: '9811100001' },
  { name: 'phone', width: 390, height: 844, mobile: '9811100002' },
] as const;

const PIN = '4821';

async function typeInto(page: Page, group: string, code: string) {
  const first = page.getByRole('group', { name: group }).getByRole('textbox').first();
  await expect(first).toBeVisible();
  await first.focus();
  await page.keyboard.type(code);
}

async function requestOtp(page: Page, mobile: string) {
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await typeInto(page, 'One-time password', DEV_OTP);
}

for (const viewport of VIEWPORTS) {
  test(`account deletion: delete, logged out, login refused on ${viewport.name}`, async ({
    page,
  }) => {
    // The OTP resend throttle (30 s per mobile) sits between the two logins.
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await page.goto('/login?redirect=%2Fsettings%2Fsecurity');
    await requestOtp(page, viewport.mobile);
    await typeInto(page, 'New PIN', PIN);
    await typeInto(page, 'Confirm PIN', PIN);
    await page.getByRole('button', { name: 'Set PIN' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete your nthstock account?' });
    await expect(dialog.getByText('Your watchlists and price alerts')).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'delete account dialog');
    const submit = dialog.getByRole('button', { name: 'Delete my account' });
    await expect(submit).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
    await submit.click();

    const stepUp = page.getByRole('dialog', { name: 'Confirm it is you' });
    await expect(stepUp).toBeVisible();
    await typeInto(page, 'Your PIN', PIN);
    await stepUp.getByRole('button', { name: 'Confirm' }).click();

    await expect(page).toHaveURL(/\/login\?deleted=/);
    await expect(
      page.getByText(/Your account is deleted and you are logged out everywhere/),
    ).toBeVisible();
    // The trusted browser is forgotten: the mobile step, not PIN entry.
    await expect(page.getByRole('textbox', { name: 'Mobile number' })).toBeVisible();

    await page.waitForTimeout(31_000);
    await requestOtp(page, viewport.mobile);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Account deletion in progress' }),
    ).toBeVisible();
    await expect(page.getByText(/Its data is erased for good on/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Use another number' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Log in to nthstock' })).toBeVisible();
  });
}

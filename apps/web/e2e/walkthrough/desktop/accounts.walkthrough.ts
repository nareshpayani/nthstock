import { base32Decode, totpCode } from '@nthstock/utils';
import { expect, type Page } from '@playwright/test';
import { clip, freshMobile, logInOnScreen } from '../support/clip';
import { pointer, say } from '../support/narration';

// Account and security clips (NSTOCK-0390): login with OTP and PIN, two-factor authentication,
// active sessions, and DPDP consent and account deletion, on a 1440 × 900 desktop.

const PIN = '4821';
const DEMO_MOBILE = '9000000001';

async function typeInto(page: Page, group: string, code: string) {
  const first = page.getByRole('group', { name: group }).locator('input').first();
  await expect(first).toBeVisible();
  await first.click();
  await pointer(page).keys(code);
}

async function logOut(page: Page) {
  const act = pointer(page);
  await act.click(page.getByRole('button', { name: /^Account: / }));
  await act.click(page.getByRole('menuitem', { name: 'Log out' }));
  await expect(page).toHaveURL(/\/login/);
}

clip('login', 'mobile, OTP, PIN, and back in with the PIN', async (page) => {
  const act = pointer(page);
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Log in to nthstock' })).toBeVisible();
  await say(page, 'Accounts: log in with a mobile number and a one-time password.', 2600);
  await logInOnScreen(page, '9876543210', { pin: PIN, narrate: true });
  await expect(page).toHaveURL(/\/dashboard$/);
  const account = page.getByRole('button', { name: /^Account: / });
  await expect(account).toBeVisible();
  await say(page, 'Logged in. The session survives a reload (an httpOnly refresh cookie).');
  await page.reload();
  await expect(account).toBeVisible();
  await act.click(account);
  await say(page, 'The profile menu masks the mobile number and shows the KYC status.', 2600);
  await act.click(page.getByRole('menuitem', { name: 'Log out' }));
  await expect(page).toHaveURL(/\/login/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  await say(page, 'This browser is trusted, so next time it asks only for the PIN.', 2600);
  await typeInto(page, 'PIN', PIN);
  await expect(page).toHaveURL(/\/dashboard$/);
  await say(page, 'Back in with four digits. Five wrong PINs lock it; an OTP always works.', 3000);
});

clip('twoFactor', 'turn on two-factor authentication and log in with a code', async (page) => {
  const act = pointer(page);
  await page.goto('/login?redirect=%2Fsettings%2Fsecurity');
  await logInOnScreen(page, freshMobile(), { pin: PIN });
  await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();
  await say(
    page,
    'Settings, Security: two-factor authentication with any authenticator app.',
    2600,
  );
  await act.click(page.getByRole('button', { name: 'Turn on' }));
  const stepUp = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(stepUp).toBeVisible();
  await say(page, 'Sensitive changes ask you to confirm it is you first: here, the PIN.');
  await typeInto(page, 'Your PIN', PIN);
  await act.click(stepUp.getByRole('button', { name: 'Confirm' }));

  const setup = page.getByRole('dialog', { name: 'Turn on two-factor authentication' });
  await expect(
    setup.getByRole('img', { name: 'QR code for your authenticator app' }),
  ).toBeVisible();
  await say(page, 'Scan the QR code, or type the setup key into the app.', 2800);
  const key = (await setup.getByTestId('totp-setup-key').textContent())?.trim() ?? '';
  expect(key, 'the TOTP setup key').not.toBe('');
  const secret = base32Decode(key);
  await act.click(setup.getByRole('button', { name: 'Next' }));
  await say(page, 'Enter the 6-digit code the app shows (RFC 6238, 30-second steps).', 1600);
  await typeInto(page, 'Code from your authenticator app', await totpCode(secret, Date.now()));
  const codes = setup.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem');
  await expect(codes).toHaveCount(10);
  await say(page, 'Ten one-time recovery codes, shown once. Copy or download them.', 2800);
  const recovery = (await codes.first().textContent())?.trim() ?? '';
  expect(recovery, 'a recovery code').not.toBe('');
  await act.click(setup.getByRole('checkbox', { name: 'I have saved these codes' }));
  await act.click(setup.getByRole('button', { name: 'Done' }));
  await expect(page.getByLabel('Two-factor authentication is on')).toBeVisible();
  await say(page, 'Two-factor authentication is on.', 2000);

  await logOut(page);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  await say(page, 'Next login: the PIN first, then the authenticator code.', 1800);
  await typeInto(page, 'PIN', PIN);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Two-factor authentication' }),
  ).toBeVisible();
  await say(page, 'Lost the phone? A recovery code works once instead.', 2000);
  await act.click(page.getByRole('button', { name: 'Use a recovery code instead' }));
  await act.type(page.getByRole('textbox', { name: 'Recovery code' }), recovery);
  await act.click(page.getByRole('button', { name: 'Verify' }));
  await expect(page).toHaveURL(/\/(dashboard|settings\/security)$/);
  await say(page, 'Logged in with the second factor.', 2400);
});

clip('activeSessions', 'see where you are logged in and log other devices out', async (page) => {
  const act = pointer(page);
  await page.goto('/login?redirect=%2Fsettings%2Fsecurity');
  await logInOnScreen(page, DEMO_MOBILE, { pin: PIN });
  await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();
  const list = page.getByRole('list', { name: 'Where you are logged in' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await list.scrollIntoViewIfNeeded();
  await say(
    page,
    'Where you are logged in: every browser and phone, with This device and Trusted badges.',
    3200,
  );
  await act.click(page.getByRole('button', { name: 'Log out Chrome on Windows' }));
  await act.click(
    page
      .getByRole('dialog', { name: 'Log out this device?' })
      .getByRole('button', { name: 'Log out' }),
  );
  const stepUp = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(stepUp).toBeVisible();
  await say(page, 'Confirm with the PIN. That device is refused on its very next request.', 1800);
  await typeInto(page, 'Your PIN', PIN);
  await act.click(stepUp.getByRole('button', { name: 'Confirm' }));
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await say(page, 'Chrome on Windows is logged out. Now all the others at once.', 2000);
  await act.click(page.getByRole('button', { name: 'Log out all other devices' }));
  await act.click(
    page
      .getByRole('dialog', { name: 'Log out all other devices?' })
      .getByRole('button', { name: 'Log out all other devices' }),
  );
  await expect(page.getByText('You are logged in only on this device.')).toBeVisible();
  await say(page, 'Only this device is left.', 2600);
});

clip('accountDeletion', 'DPDP consent at sign-up and deleting the account', async (page) => {
  const act = pointer(page);
  // A running page clock, so the 30-second OTP resend wait can be skipped on screen.
  await page.clock.install();
  const mobile = freshMobile();
  await page.goto('/login?redirect=%2Fsettings%2Fsecurity');
  await expect(page.getByRole('checkbox', { name: /I agree/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /I agree/ }).scrollIntoViewIfNeeded();
  await say(
    page,
    'DPDP Act 2023: sign-up records which version of the terms and privacy notice you accepted.',
    3200,
  );
  await logInOnScreen(page, mobile, { pin: PIN });
  await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete account' }).scrollIntoViewIfNeeded();
  await say(page, 'Your data, your call: delete the account from Settings, Security.', 2400);
  await act.click(page.getByRole('button', { name: 'Delete account' }));
  const dialog = page.getByRole('dialog', { name: 'Delete your nthstock account?' });
  await expect(dialog).toBeVisible();
  await say(page, 'It lists exactly what is deleted, and needs DELETE typed to go on.', 3000);
  await act.type(dialog.getByRole('textbox', { name: 'Type DELETE to confirm' }), 'DELETE');
  await act.click(dialog.getByRole('button', { name: 'Delete my account' }));
  const stepUp = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(stepUp).toBeVisible();
  await typeInto(page, 'Your PIN', PIN);
  await act.click(stepUp.getByRole('button', { name: 'Confirm' }));
  await expect(page).toHaveURL(/\/login\?deleted=/);
  await say(
    page,
    'Deleted: logged out everywhere, open orders cancelled, data erased for good in 30 days.',
    3200,
  );
  await page.clock.fastForward('00:31');
  await say(page, 'Try to log in again with the same mobile…', 1200);
  await logInOnScreen(page, mobile, { stopAfterOtp: true });
  await expect(
    page.getByRole('heading', { level: 1, name: 'Account deletion in progress' }),
  ).toBeVisible();
  await say(page, 'Refused: the account is being erased, with the date it is gone for good.', 3200);
});

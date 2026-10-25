import { DEV_OTP } from '@nthstock/contracts';
import { base32Decode, totpCode } from '@nthstock/utils';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { logIn, uniqueMobile } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';
import { API_TAG, E2E_MODE } from './support/env';
import { setClock } from './support/testControls';

// T-242 (NSTOCK-0242): the security settings journey, in msw mode and (tagged @api) against
// apps/api and apps/realtime. Turn on two-factor behind an OTP step-up, log out, log in with the
// OTP and an authenticator code, log out another session behind a step-up with the code, and
// delete the account; axe on every step, with no serious or critical violation allowed.
//
// The other session: in msw mode the demo user's seeded laptop and phone (the mock lives in the
// page, so a second browser cannot add one); in api mode a fresh mobile logged in from a second
// browser context.
//
// Time comes from the test clock (setClock), never a wait: every step that sends an OTP or takes
// an authenticator code first moves the clock to 1 s into a TOTP step two steps on. That clears the
// 30 s OTP resend throttle, gives each code a step no earlier code used (a replayed step fails),
// and lets the test play the authenticator app at exactly the backend's time.

const DEMO_MOBILE = '9000000001';
const STEP_MS = 30_000;

async function typeInto(page: Page, group: string, code: string) {
  const first = page.getByRole('group', { name: group }).getByRole('textbox').first();
  await expect(first).toBeVisible();
  await first.focus();
  await page.keyboard.type(code);
}

/** The test clock, in epoch ms; `nextStep` moves it, and the page's and backend's, on. */
let now = 0;

async function nextStep(page: Page) {
  now = (Math.floor(now / STEP_MS) + 2) * STEP_MS + 1_000;
  await setClock(page, new Date(now).toISOString());
}

/** api mode: a second session for `mobile`, from its own browser context, left logged in. */
async function logInElsewhere(browser: Browser, mobile: string) {
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto('/login?redirect=%2Fdashboard');
    await logIn(other, mobile);
    await expect(other).toHaveURL(/\/dashboard$/);
  } finally {
    await context.close();
  }
}

test(`security journey: two-factor on, log in with it, log out a session, delete the account ${API_TAG}`, async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const api = E2E_MODE === 'api';
  const mobile = api ? uniqueMobile() : DEMO_MOBILE;
  now = Date.now();
  await nextStep(page);
  if (api) {
    // First, so this page's sessions list has it from the start.
    await logInElsewhere(browser, mobile);
    await nextStep(page);
  }

  await page.goto('/login?redirect=%2Fsettings%2Fsecurity');
  await expectNoSeriousA11yViolations(page, 'login');
  await logIn(page, mobile);
  await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();
  const sessions = page.getByRole('list', { name: 'Where you are logged in' });
  const otherSessions = api ? 1 : 2;
  await expect(sessions.getByRole('listitem')).toHaveCount(otherSessions + 1);
  await expect(page.getByLabel('Two-factor authentication is off')).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'security settings, two-factor off');

  // 1. Turn on two-factor: an OTP step-up (no PIN on this account), then the setup dialog.
  await page.getByRole('button', { name: 'Turn on' }).click();
  const stepUp = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(stepUp).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'step-up, send OTP', '[role="dialog"]');
  await nextStep(page);
  await stepUp.getByRole('button', { name: 'Send OTP' }).click();
  await typeInto(page, 'One-time password', DEV_OTP);
  await expectNoSeriousA11yViolations(page, 'step-up, OTP', '[role="dialog"]');
  await stepUp.getByRole('button', { name: 'Confirm' }).click();

  const setup = page.getByRole('dialog', { name: 'Turn on two-factor authentication' });
  await expect(
    setup.getByRole('img', { name: 'QR code for your authenticator app' }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'two-factor setup, scan', '[role="dialog"]');
  const secret = base32Decode((await setup.getByTestId('totp-setup-key').textContent()) ?? '');
  await setup.getByRole('button', { name: 'Next' }).click();
  await expectNoSeriousA11yViolations(page, 'two-factor setup, code', '[role="dialog"]');
  await typeInto(page, 'Code from your authenticator app', await totpCode(secret, now));

  const codes = setup.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem');
  await expect(codes).toHaveCount(10);
  await expectNoSeriousA11yViolations(page, 'two-factor setup, recovery codes', '[role="dialog"]');
  await setup.getByRole('checkbox', { name: 'I have saved these codes' }).check();
  await setup.getByRole('button', { name: 'Done' }).click();

  // With other sessions open, the page offers to log them out; keep them for step 3.
  const offer = page.getByRole('dialog', { name: 'Log out your other devices too?' });
  await expect(offer).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'log out other devices offer', '[role="dialog"]');
  await offer.getByRole('button', { name: 'Not now' }).click();
  await expect(offer).toBeHidden();
  await expect(page.getByLabel('Two-factor authentication is on')).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'security settings, two-factor on');

  // 2. Log out, then log in with the OTP and the authenticator code.
  await page.getByRole('button', { name: /account: /i }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await nextStep(page);
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await typeInto(page, 'One-time password', DEV_OTP);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Two-factor authentication' }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'login, two-factor code');
  // The code step verifies as soon as all six digits are in.
  await typeInto(page, 'Authentication code', await totpCode(secret, now));
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 3. Log out another session, behind a step-up that now needs the authenticator code too.
  await page.getByRole('button', { name: /account: /i }).click();
  await page.getByRole('menuitem', { name: 'Security' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();
  await expect(sessions.getByRole('listitem')).toHaveCount(otherSessions + 1);
  await expect(sessions.getByRole('listitem').filter({ hasText: 'This device' })).toHaveCount(1);
  await expectNoSeriousA11yViolations(page, 'active sessions');
  await sessions
    .getByRole('listitem')
    .filter({ hasNotText: 'This device' })
    .first()
    .getByRole('button', { name: /^Log out / })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Log out this device?' });
  await expect(confirm).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'log out a device, confirm', '[role="dialog"]');
  await confirm.getByRole('button', { name: 'Log out' }).click();
  await expect(stepUp).toBeVisible();
  await nextStep(page);
  await stepUp.getByRole('button', { name: 'Send OTP' }).click();
  await typeInto(page, 'One-time password', DEV_OTP);
  await typeInto(page, 'Code from your authenticator app', await totpCode(secret, now));
  await expectNoSeriousA11yViolations(page, 'step-up, OTP and code', '[role="dialog"]');
  await stepUp.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/ is logged out$/).first()).toBeVisible();
  await expect(sessions.getByRole('listitem')).toHaveCount(otherSessions);
  await expectNoSeriousA11yViolations(page, 'active sessions, one logged out');

  // 4. Delete the account: DELETE typed, and still stepped up from step 3, so no second ask.
  await page.getByRole('button', { name: 'Delete account' }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete your nthstock account?' });
  await expect(deletion.getByText('Your watchlists and price alerts')).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'delete account dialog', '[role="dialog"]');
  await deletion.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
  await deletion.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/login\?deleted=/);
  await expect(
    page.getByText(/Your account is deleted and you are logged out everywhere/),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'login after deletion');

  // The deleted account cannot log in again until its data is erased.
  await nextStep(page);
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(mobile);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await typeInto(page, 'One-time password', DEV_OTP);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Account deletion in progress' }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page, 'account deletion in progress');
});

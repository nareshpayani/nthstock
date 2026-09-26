import { expect, test, type Page } from '@playwright/test';

// T-091: the login journey in msw mode. Mobile → OTP → set PIN → dashboard; a reload keeps the
// session (refresh cookie); after logging out, a reload opens PIN entry on this trusted browser and
// the PIN logs back in. The mock OTP is the fixed dev OTP 123456 (see src/mocks/handlers/auth.ts).

const MOBILE = '9876543210';
const DEV_OTP = '123456';
const PIN = '4821';

/** Types digits into a group of one-digit boxes; each digit moves focus to the next box. */
async function typeDigits(page: Page, group: string, digits: string) {
  await page.getByRole('group', { name: group }).getByRole('textbox').first().click();
  await page.keyboard.type(digits);
}

async function typePin(page: Page, group: string, digits: string) {
  // PIN boxes are password inputs, which have no textbox role.
  await page.getByRole('group', { name: group }).locator('input').first().click();
  await page.keyboard.type(digits);
}

test('mobile, OTP, set PIN, dashboard, then reload and log in with the PIN', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Log in to nthstock' })).toBeVisible();

  // Mobile number with the DPDP consent.
  await page.getByRole('textbox', { name: 'Mobile number' }).fill('12345');
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await expect(page.getByText(/Enter a 10-digit mobile number/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(MOBILE);
  await page.getByRole('button', { name: 'Get OTP' }).click();

  // OTP: the dev OTP is shown in mock mode, and a full code submits itself.
  await expect(page.getByRole('heading', { level: 1, name: 'Enter the OTP' })).toBeVisible();
  await expect(page.getByText(`Mock mode: the OTP is always ${DEV_OTP}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: /Resend OTP in 0:\d\d/ })).toBeDisabled();
  await typeDigits(page, 'One-time password', DEV_OTP);

  // First login: set a PIN.
  await expect(page.getByRole('heading', { level: 1, name: 'Set a login PIN' })).toBeVisible();
  await typePin(page, 'New PIN', PIN);
  await typePin(page, 'Confirm PIN', PIN);
  await page.getByRole('button', { name: 'Set PIN' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  const account = page.getByRole('button', { name: 'Account: nthstock investor' });
  await expect(account).toBeVisible();

  // A reload keeps the session: the refresh cookie restores it.
  await page.reload();
  await expect(account).toBeVisible();

  // The profile menu shows the masked number and the mocked KYC badge; log out.
  await account.click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText(`+91 ******${MOBILE.slice(-4)}`)).toBeVisible();
  await expect(menu.getByText('KYC not started')).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Reload: this browser is trusted, so it opens on PIN entry.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mobile number' })).toHaveCount(0);
  await typePin(page, 'PIN', PIN);

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Account: nthstock investor' })).toBeVisible();
});

test('a guarded page sends you to log in and back', async ({ page }) => {
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/login\?redirect=%2Forders$/);
  await page.getByRole('textbox', { name: 'Mobile number' }).fill('9876500001');
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Get OTP' }).click();
  await typeDigits(page, 'One-time password', DEV_OTP);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
});

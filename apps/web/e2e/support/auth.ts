import { DEV_OTP } from '@nthstock/contracts';
import { expect, type Page } from '@playwright/test';

/**
 * A fresh 10-digit mobile per test attempt, so a retry in api mode (one shared apps/api) never
 * starts with the orders of the failed attempt.
 */
export const uniqueMobile = () =>
  `9${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`;

/**
 * Logs in on the login page the app is showing: mobile with consent, the dev OTP (both modes run
 * outside production), and skip the PIN. Keyboard only, so the keyboard spec can use it too.
 */
export async function logIn(page: Page, mobile: string = uniqueMobile()): Promise<void> {
  const field = page.getByRole('textbox', { name: 'Mobile number' });
  await expect(field).toBeVisible();
  await field.focus();
  await page.keyboard.type(mobile);
  await page.getByRole('checkbox', { name: /I agree/ }).focus();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Get OTP' }).focus();
  await page.keyboard.press('Enter');
  const otp = page.getByRole('group', { name: 'One-time password' }).getByRole('textbox').first();
  await expect(otp).toBeVisible();
  await otp.focus();
  await page.keyboard.type(DEV_OTP);
  const skip = page.getByRole('button', { name: 'Skip for now' });
  await expect(skip).toBeVisible();
  await skip.focus();
  await page.keyboard.press('Enter');
  // The login page stays up until the redirect target has loaded.
  await expect(skip).toBeHidden();
}

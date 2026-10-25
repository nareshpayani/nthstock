import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEV_OTP } from '@nthstock/contracts';
import { expect, test, type Page } from '@playwright/test';
import { captionsOf, pointer, say, startCaptions } from './narration';

// One walkthrough clip per Playwright test (docs/runbooks/demo-walkthrough.md). The test records
// its video as usual; `clip` saves it under a stable name, test-results/walkthrough/clips/<id>.webm,
// with its captions as <id>.vtt, and tools/demo/recordWalkthrough.sh encodes each one to
// apps/web/public/demo/<id>.mp4 beside its captions track.

export const CLIPS_DIR = join(import.meta.dirname, '../../../test-results/walkthrough/clips');

/** Records `body` as the clip `id` (a camelCase file name, listed on the guide's video tab). */
export function clip(id: string, title: string, body: (page: Page) => Promise<void>): void {
  test(`${id}: ${title}`, async ({ page }) => {
    test.setTimeout(300_000);
    startCaptions(page);
    await body(page);
    await say(page, '', 400);
    const captions = captionsOf(page);
    const video = page.video();
    await page.close();
    if (!video) throw new Error('video recording is off');
    await mkdir(CLIPS_DIR, { recursive: true });
    await writeFile(join(CLIPS_DIR, `${id}.vtt`), captions);
    // saveAs can race Playwright's own copy of the video into the test's output folder; the file
    // is complete once the page is closed, so try again.
    const target = join(CLIPS_DIR, `${id}.webm`);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await video.saveAs(target);
        break;
      } catch (error) {
        if (existsSync(target)) break;
        if (attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  });
}

/** A fresh 10-digit mobile, so each clip starts as a new user. */
export const freshMobile = (): string =>
  `9${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`;

/**
 * Logs in on the login page the app is showing, on screen: mobile, consent, Get OTP, the dev OTP,
 * then sets `pin` or skips the PIN step (`stopAfterOtp` leaves the next step to the caller).
 */
export async function logInOnScreen(
  page: Page,
  mobile: string,
  options: { pin?: string; narrate?: boolean; stopAfterOtp?: boolean } = {},
): Promise<void> {
  const act = pointer(page);
  const narrate = options.narrate ?? false;
  const field = page.getByRole('textbox', { name: 'Mobile number' });
  await expect(field).toBeVisible();
  if (narrate) await say(page, 'Log in with a mobile number. Accept the terms and get an OTP.');
  await act.type(field, mobile);
  await act.click(page.getByRole('checkbox', { name: /I agree/ }));
  await act.click(page.getByRole('button', { name: 'Get OTP' }));
  const otp = page.getByRole('group', { name: 'One-time password' }).getByRole('textbox').first();
  await expect(otp).toBeVisible();
  if (narrate) await say(page, `Mock mode shows the OTP: ${DEV_OTP}. A full code submits itself.`);
  await otp.click();
  await act.keys(DEV_OTP);
  if (options.stopAfterOtp) return;
  if (options.pin) {
    await expect(page.getByRole('heading', { level: 1, name: 'Set a login PIN' })).toBeVisible();
    if (narrate) await say(page, 'First login on this browser: set a 4-digit PIN for next time.');
    await page.getByRole('group', { name: 'New PIN' }).locator('input').first().click();
    await act.keys(options.pin);
    await page.getByRole('group', { name: 'Confirm PIN' }).locator('input').first().click();
    await act.keys(options.pin);
    await act.click(page.getByRole('button', { name: 'Set PIN' }));
  } else {
    const skip = page.getByRole('button', { name: 'Skip for now' });
    await expect(skip).toBeVisible();
    await act.click(skip);
    await expect(skip).toBeHidden();
  }
}

/** Monday 28 Sep 2026, 10:00 IST: NSE is open for the paper engine. */
export const MONDAY_10_00_IST = new Date('2026-09-28T04:30:00.000Z');

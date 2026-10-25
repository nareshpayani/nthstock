import { expect, test, type Page } from '@playwright/test';
import { logIn } from './support/auth';
import { API_TAG, DEV_TAG } from './support/env';
import { SCREENS } from './screens/screens';

// The app on localhost logs no errors or warnings (NSTOCK-0357): every screen in the screenshot
// list, logged out and then logged in, with the console, uncaught errors and failed requests
// watched. It runs on every PR and on develop, in mock mode, on the full stack (@api) and on the
// Vite dev server with the packages' dist deleted (@dev, as after a fresh pull), so a console
// error fails CI and the Fixer picks it up like any other failure.

/**
 * The one expected miss: the first page load of a new browser asks `POST /v1/auth/refresh` whether
 * a refresh cookie holds a session, and with none it answers 401. Later loads skip that question.
 */
const EXPECTED = [/\/v1\/auth\/refresh$/];

/** How long each screen gets after its main region shows. */
const SETTLE_MS = 1_500;

type Problem = { kind: string; text: string; where: string };

function watch(page: Page): Problem[] {
  const problems: Problem[] = [];
  const where = () => new URL(page.url()).pathname;
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const source = message.location().url;
    if (EXPECTED.some((pattern) => pattern.test(source))) return;
    problems.push({
      kind: message.type(),
      text: `${message.text()} ${source}`.trim(),
      where: where(),
    });
  });
  page.on('pageerror', (error) => {
    problems.push({ kind: 'uncaught', text: error.message, where: where() });
  });
  page.on('response', (response) => {
    const url = response.url();
    if (response.status() < 400 || EXPECTED.some((pattern) => pattern.test(url))) return;
    problems.push({ kind: `HTTP ${String(response.status())}`, text: url, where: where() });
  });
  return problems;
}

async function visitAll(page: Page, authed: boolean) {
  for (const screen of SCREENS.filter((candidate) => candidate.authed === authed)) {
    await page.goto(screen.path);
    await expect(page.getByRole('main')).toBeVisible();
    // Pages that poll (market depth) or stream never go network-idle, so give each screen a
    // fixed moment for its lazy chunks, first quotes and first tick to land.
    await page.waitForTimeout(SETTLE_MS);
  }
}

test(`every screen loads without console errors, logged out and logged in ${API_TAG} ${DEV_TAG}`, async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watch(page);

  await visitAll(page, false);
  await page.goto('/login');
  await logIn(page);
  await expect(page).not.toHaveURL(/\/login/);
  await visitAll(page, true);

  expect(problems, 'console errors, uncaught errors or failed requests on localhost').toEqual([]);
});

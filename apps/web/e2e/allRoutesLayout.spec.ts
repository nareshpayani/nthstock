import { DEMO_SEED_USER } from '@nthstock/paperEngine';
import { expect, test, type Page } from '@playwright/test';
import { logIn } from './support/auth';

// Every route at phone and tablet widths (NSTOCK-0435): the viewport matrix checks the trade flow
// in depth; this checks every other screen for the breakage a person sees first. The demo user is
// signed in, so tables have rows (orders, positions, holdings) and are measured full, not empty.
//
//   1. no sideways page scroll;
//   2. nothing runs past the screen, unless it sits in a horizontal scroller (a table that scrolls
//      inside its card is fine; one that spills out of it is not);
//   3. nothing is cut by an ancestor that hides overflow without scrolling.
//
// A failure names the route, the width and the element. A new route goes in ROUTES (and in
// e2e/screens/screens.ts for the PR screenshots).

const ROUTES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'stockDetail', path: '/stocks/INFY' },
  { name: 'indexDetail', path: '/stocks/NIFTYBANK?exchange=NSE' },
  { name: 'indexEtf', path: '/stocks/NIFTYETF?exchange=NSE' },
  { name: 'portfolio', path: '/portfolio' },
  { name: 'positions', path: '/positions' },
  { name: 'ordersOpen', path: '/orders?tab=open' },
  { name: 'ordersExecuted', path: '/orders?tab=executed' },
  { name: 'ordersCancelled', path: '/orders?tab=cancelled' },
  { name: 'funds', path: '/funds' },
  { name: 'security', path: '/settings/security' },
  { name: 'account', path: '/account' },
  { name: 'watchlist', path: '/watchlist' },
] as const;

/** Every guide tab: each is a long page of tables, diagrams and code. */
const GUIDE_TABS = [
  'overview',
  'demo',
  'demo-two',
  'features',
  'walkthroughs',
  'trade-from-charts',
  'architecture',
  'low-level-design',
  'market-data',
  'tech-stack',
  'performance',
  'scalability',
  'security',
  'folders',
  'testing',
  'ci-cd',
  'agents',
  'roadmap',
] as const;

const ALL_ROUTES = [
  ...ROUTES,
  ...GUIDE_TABS.map((tab) => ({ name: `guide ${tab}`, path: `/guide?tab=${tab}` })),
];

const WIDTHS = [
  { width: 320, height: 640 },
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
] as const;

/** Monday 28 Sep 2026, 10:00 IST: NSE open, so live screens show their full state. */
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

type Problem = { element: string; detail: string };

/** Elements past the screen or cut by a clipping ancestor, outside any horizontal scroller. */
function layoutProblems(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const problems: { element: string; detail: string }[] = [];
    const width = document.documentElement.clientWidth;
    const describe = (element: Element) => {
      const label =
        element.getAttribute('aria-label') ??
        (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `<${element.tagName.toLowerCase()}> "${label}"`;
    };
    const reported = new Set<Element>();
    const root = document.querySelector('main') ?? document.body;
    for (const element of root.querySelectorAll('*')) {
      if (element.closest('.sr-only, canvas, svg, [data-layout-ignore], [aria-hidden="true"]'))
        continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Report the outermost offender only: its children overflow with it.
      let parentReported = false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (reported.has(parent)) {
          parentReported = true;
          break;
        }
      }
      if (parentReported) continue;
      let scroller = false;
      let clipChecked = false;
      let problem: string | null = null;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        const overflow = parentStyle.overflowX;
        if (overflow === 'auto' || overflow === 'scroll') {
          scroller = true;
          break;
        }
        // The nearest clipping ancestor decides "cut" (an ellipsis is a deliberate cut); keep
        // walking, since a table cell that clips can itself sit in a horizontal scroller.
        if ((overflow === 'hidden' || overflow === 'clip') && !clipChecked) {
          clipChecked = true;
          const box = parent.getBoundingClientRect();
          const cut = rect.right > box.right + 1 || rect.left < box.left - 1;
          if (cut && parentStyle.textOverflow !== 'ellipsis') {
            problem = `cut by ${describe(parent)}`;
          }
        }
      }
      if (!problem && !scroller && (rect.right > width + 1 || rect.left < -1)) {
        problem = `runs past the screen (${String(Math.round(rect.right))} of ${String(width)} px)`;
      }
      if (problem && !scroller) {
        reported.add(element);
        problems.push({ element: describe(element), detail: problem });
      }
    }
    return problems;
  });
}

/** Opens one route at one size and lists what is broken there. */
async function checkAt(
  page: Page,
  name: string,
  path: string,
  size: { width: number; height: number },
): Promise<string[]> {
  await page.setViewportSize(size);
  await page.goto(path);
  await expect(page.locator('main')).toBeVisible();
  // Let lazy cards and tables load and the 160 ms content fade finish.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const at = `${name} at ${String(size.width)} px`;
  const failures: string[] = [];
  const sideScroll = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (sideScroll > 1) failures.push(`${at}: the page scrolls sideways by ${String(sideScroll)} px`);
  for (const problem of await layoutProblems(page)) {
    failures.push(`${at}: ${problem.element} ${problem.detail}`);
  }
  return failures;
}

test.describe('the login page fits phones and tablets (NSTOCK-0435)', () => {
  test('login at every width', async ({ page }) => {
    test.setTimeout(90_000);
    await page.clock.setFixedTime(MONDAY_10_IST);
    const failures: string[] = [];
    for (const size of WIDTHS) failures.push(...(await checkAt(page, 'login', '/login', size)));
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

test.describe('the login step is the whole phone screen (NSTOCK-0481)', () => {
  // 390 x 664 is an iPhone with Safari's toolbars showing: the step fits without a scroll, edge to
  // edge, and its text links keep a 44 px target.
  for (const size of [
    { width: 360, height: 740 },
    { width: 390, height: 664 },
    { width: 430, height: 932 },
  ]) {
    test(`login at ${String(size.width)} x ${String(size.height)}`, async ({ page }) => {
      await page.clock.setFixedTime(MONDAY_10_IST);
      await page.setViewportSize(size);
      await page.goto('/login');
      await expect(page.getByRole('textbox', { name: 'Mobile number' })).toBeVisible();
      const fit = await page.evaluate(() => {
        const card = document.querySelector('main > div');
        if (!card) return null;
        const style = getComputedStyle(card);
        return {
          scrolls: document.documentElement.scrollHeight > window.innerHeight,
          left: card.getBoundingClientRect().left,
          width: card.getBoundingClientRect().width,
          border: style.borderTopWidth,
        };
      });
      expect(fit).toEqual({ scrolls: false, left: 0, width: size.width, border: '0px' });
      for (const name of [/^Documentation/, /^Explore the markets/]) {
        const box = await page.getByRole('link', { name }).boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe('every signed-in route fits phones and tablets (NSTOCK-0435)', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(MONDAY_10_IST);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login?demo=1&redirect=%2Fportfolio');
    await logIn(page, DEMO_SEED_USER.mobile);
    await page.waitForURL(/\/portfolio$/);
  });

  for (const route of ALL_ROUTES) {
    test(`${route.name} at every width`, async ({ page }) => {
      test.setTimeout(90_000);
      const failures: string[] = [];
      for (const size of WIDTHS)
        failures.push(...(await checkAt(page, route.name, route.path, size)));
      expect(failures, failures.join('\n')).toEqual([]);
    });
  }
});

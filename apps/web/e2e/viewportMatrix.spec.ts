import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn } from './support/auth';
import { isTouchViewport, VIEWPORT_MATRIX, type MatrixViewport } from './support/viewportMatrix';

// The viewport matrix (CR-T04, SPEC-CR-1 §6.3, AC-11): the mobile Trade from Charts flow at every
// common screen size, from a 320 px phone to a desktop, with four layout checks on the instrument
// page and on the open order ticket:
//
//   1. no sideways page scroll;
//   2. no clipped text: no text runs past the screen, or past an ancestor that hides overflow
//      without scrolling (a scroll strip is fine);
//   3. every touch target in the flow at least 44 × 44 px (touch screens);
//   4. the primary action (Buy on the page, the submit button in the ticket) on screen without
//      scrolling;
//
// plus AC-08 on the page: from 360 px the index ticker strip fits without scrolling (below 360 px it
// may scroll inside its strip, which check 2 allows).
//
// A failure names the viewport, the check and the element. Checks the craft round has not fixed
// yet are listed in KNOWN_GAPS with the story that fixes them: they run as expected failures, so
// the day a story fixes one, the run says so and the entry comes out.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so NSE is open for the paper engine.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');
const MIN_TARGET = 44;

type Check =
  'ticketOpens' | 'sideScroll' | 'clippedText' | 'touchTargets' | 'primaryAction' | 'tickerFits';
type Frame = 'page' | 'ticket';

/**
 * What today's flow still gets wrong, measured on 28 Oct 2026 before the craft round, each with the
 * story that fixes it. The story's pull request removes its rows; a row that passes fails the run.
 */
const PHONES = VIEWPORT_MATRIX.filter((viewport) => viewport.kind === 'phone').map((v) => v.name);
const TOUCH = VIEWPORT_MATRIX.filter(isTouchViewport).map((viewport) => viewport.name);
const KNOWN_GAPS: readonly {
  frame: Frame;
  check: Check;
  viewports: readonly string[];
  story: string;
}[] = [
  {
    frame: 'page',
    check: 'sideScroll',
    viewports: ['phone-320x640', 'phone-344x882'],
    story: 'CR-T13',
  },
  {
    frame: 'page',
    check: 'primaryAction',
    viewports: ['phone-320x640', 'phone-344x882'],
    story: 'CR-T13',
  },
  { frame: 'page', check: 'touchTargets', viewports: TOUCH, story: 'CR-T13, CR-T15' },
  {
    frame: 'page',
    check: 'tickerFits',
    viewports: PHONES.filter((name) => !['phone-320x640', 'phone-344x882'].includes(name)),
    story: 'CR-T14',
  },
  {
    frame: 'ticket',
    check: 'sideScroll',
    viewports: ['phone-320x640', 'phone-344x882'],
    story: 'CR-T13',
  },
  {
    frame: 'ticket',
    check: 'primaryAction',
    viewports: VIEWPORT_MATRIX.map((v) => v.name).filter((name) => name !== 'tablet-820x1180'),
    story: 'CR-T11',
  },
  {
    frame: 'ticket',
    check: 'touchTargets',
    viewports: ['landscape-844x390', 'tablet-820x1180', 'tablet-1180x820'],
    story: 'CR-T15',
  },
];

const gapFor = (viewport: MatrixViewport, frame: Frame, check: Check) =>
  KNOWN_GAPS.find(
    (gap) => gap.frame === frame && gap.check === check && gap.viewports.includes(viewport.name),
  )?.story;

type Problem = { element: string; detail: string };

/** Text that overflows the screen or a clipping ancestor. */
function clippedText(page: Page, root: Locator): Promise<Problem[]> {
  return root.evaluate((rootElement) => {
    const problems: { element: string; detail: string }[] = [];
    const width = document.documentElement.clientWidth;
    const describe = (element: Element) => {
      const label =
        element.getAttribute('aria-label') ??
        (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `<${element.tagName.toLowerCase()}> "${label}"`;
    };
    const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || seen.has(element) || !(node.textContent ?? '').trim()) continue;
      seen.add(element);
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      // aria-hidden text is still on screen (the ticker's figures), so only sr-only text is skipped.
      if (element.closest('.sr-only, canvas, [data-matrix-ignore]')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Inside a horizontal scroller, text may run past the screen: it scrolls into view.
      let scroller = false;
      // Start at the element itself: a `truncate` element cuts its own text.
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        if (overflow === 'auto' || overflow === 'scroll') {
          scroller = true;
          break;
        }
        if (overflow === 'hidden' || overflow === 'clip') {
          const box = parent.getBoundingClientRect();
          if (rect.right > box.right + 1 || rect.left < box.left - 1) {
            problems.push({ element: describe(element), detail: `cut by ${describe(parent)}` });
          }
          break;
        }
      }
      if (!scroller && (rect.right > width + 1 || rect.left < -1)) {
        problems.push({
          element: describe(element),
          detail: `runs past the screen (${String(Math.round(rect.right))} of ${String(width)} px)`,
        });
      }
    }
    return problems;
  });
}

/** Interactive elements under 44 × 44 px. */
function smallTargets(root: Locator): Promise<Problem[]> {
  return root.evaluate((rootElement, min) => {
    const problems: { element: string; detail: string }[] = [];
    const targets = rootElement.querySelectorAll(
      'button, a[href], [role="radio"], [role="tab"], [role="switch"], input:not([type="hidden"]), select',
    );
    for (const target of targets) {
      if (target.closest('[aria-hidden="true"], [data-matrix-ignore]')) continue;
      // The chart library's required attribution link, not part of the flow.
      if (target.matches('a[href*="tradingview"]')) continue;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(target);
      if (style.visibility === 'hidden') continue;
      if (rect.width < min - 0.5 || rect.height < min - 0.5) {
        const label =
          target.getAttribute('aria-label') ?? (target.textContent ?? '').trim().slice(0, 40);
        problems.push({
          element: `<${target.tagName.toLowerCase()}> "${label}"`,
          detail: `${String(Math.round(rect.width))} × ${String(Math.round(rect.height))} px`,
        });
      }
    }
    return problems;
  }, MIN_TARGET);
}

async function onScreen(page: Page, target: Locator): Promise<Problem[]> {
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) return [{ element: String(target), detail: 'not rendered' }];
  if (
    box.y < 0 ||
    box.y + box.height > viewport.height ||
    box.x < 0 ||
    box.x + box.width > viewport.width
  ) {
    return [
      {
        element: (await target.getAttribute('aria-label')) ?? (await target.innerText()),
        detail: `at y ${String(Math.round(box.y))} on a ${String(viewport.height)} px screen`,
      },
    ];
  }
  return [];
}

/** The header's index strip scrolls instead of fitting. */
async function tickerOverflow(page: Page): Promise<Problem[]> {
  const strip = page.getByRole('region', { name: 'Market status and indices' });
  // A missing strip must fail the check, not pass it by measuring nothing.
  await expect(strip).toBeVisible({ timeout: 10_000 });
  const { scroll, width } = await strip.evaluate((element) => ({
    scroll: element.scrollWidth,
    width: element.clientWidth,
  }));
  return scroll > width + 1
    ? [
        {
          element: 'index ticker',
          detail: `${String(scroll)} px of content in ${String(width)} px`,
        },
      ]
    : [];
}

async function sideScroll(page: Page): Promise<Problem[]> {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
  }));
  return scroll > width + 1
    ? [{ element: 'page', detail: `${String(scroll)} px wide on a ${String(width)} px screen` }]
    : [];
}

type Result = { frame: Frame; check: Check; problems: Problem[] };

/**
 * Every check of one viewport, judged together, so one run names every problem at once: a check
 * that fails and is not a known gap, and a known gap that passes now (its entry comes out).
 */
function judge(viewport: MatrixViewport, results: Result[]) {
  const report: string[] = [];
  for (const { frame, check, problems } of results) {
    const gap = gapFor(viewport, frame, check);
    if (gap && problems.length === 0) {
      report.push(`${frame} ${check} passes now: remove it from KNOWN_GAPS (${gap})`);
    } else if (!gap && problems.length > 0) {
      report.push(`${frame} ${check}:`);
      for (const problem of problems) report.push(`  ${problem.element}: ${problem.detail}`);
    }
  }
  if (process.env['MATRIX_REPORT']) {
    console.log(`MATRIX ${JSON.stringify({ viewport: viewport.name, results })}`);
  }
  expect(report, `${viewport.name}\n${report.join('\n')}`).toEqual([]);
}

for (const viewport of VIEWPORT_MATRIX) {
  test.describe(`matrix ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: isTouchViewport(viewport),
      hasTouch: isTouchViewport(viewport),
    });

    test(`the flow holds at ${viewport.name} (${viewport.examples})`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.clock.setFixedTime(MONDAY_10_IST);
      await page.goto('/login?redirect=%2Fstocks%2FINFY');
      await logIn(page);
      await expect(page).toHaveURL(/\/stocks\/INFY$/);
      await expect(
        page
          .getByRole('figure', { name: /INFY .* chart/ })
          .locator('canvas')
          .first(),
      ).toBeVisible();

      const main = page.locator('#main');
      const tradeBar = page.getByRole('group', { name: 'Trade INFY' });
      // Wait for a Buy button to render before choosing which one this layout uses.
      await expect(page.getByRole('button', { name: 'Buy INFY' }).first()).toBeVisible();
      const phoneBar = await tradeBar.isVisible();
      const buy = phoneBar
        ? tradeBar.getByRole('button', { name: 'Buy INFY' })
        : page.getByRole('button', { name: 'Buy INFY' }).first();

      const results: Result[] = [];
      const run = async (frame: Frame, check: Check, problems: Promise<Problem[]>) => {
        results.push({ frame, check, problems: await problems });
      };
      await run('page', 'sideScroll', sideScroll(page));
      await run('page', 'clippedText', clippedText(page, page.locator('body')));
      if (isTouchViewport(viewport)) {
        await run('page', 'touchTargets', smallTargets(main));
      }
      await run('page', 'primaryAction', onScreen(page, buy));
      // The index strip is a header row only below 1360 px: from there the indices sit in the top bar.
      if (viewport.width >= 360 && viewport.width < 1360) {
        await run('page', 'tickerFits', tickerOverflow(page));
      }

      let openFailure: string | undefined;
      try {
        // Where the page puts Buy off screen (a known gap), a pointer click is intercepted by the
        // content around it, so open the ticket with a click event: the gap is reported above.
        if (gapFor(viewport, 'page', 'primaryAction')) {
          await buy.dispatchEvent('click');
        } else {
          await buy.click({ timeout: 10_000 });
        }
        await expect(page.getByRole('dialog', { name: 'Trade INFY' })).toBeVisible({
          timeout: 10_000,
        });
      } catch (error) {
        openFailure = error instanceof Error ? error.message : String(error);
      }
      const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
      if (openFailure !== undefined) {
        // The ticket's checks can't run. 'ticketOpens' is never a known gap, so this always fails.
        results.push({
          frame: 'ticket',
          check: 'ticketOpens',
          problems: [{ element: 'Buy INFY', detail: `the ticket did not open: ${openFailure}` }],
        });
        judge(viewport, results);
        return;
      }
      await expect(ticket.getByRole('form', { name: 'Order details' })).toBeVisible();
      const submit = ticket.getByRole('button', { name: 'Buy INFY' });
      await run('ticket', 'sideScroll', sideScroll(page));
      await run('ticket', 'clippedText', clippedText(page, ticket));
      if (isTouchViewport(viewport)) {
        await run('ticket', 'touchTargets', smallTargets(ticket));
      }
      await run('ticket', 'primaryAction', onScreen(page, submit));
      judge(viewport, results);
    });
  });
}

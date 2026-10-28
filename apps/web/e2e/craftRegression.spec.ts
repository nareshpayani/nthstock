import { expect, test, type Page } from '@playwright/test';
import { logIn } from './support/auth';
import { expectNoSeriousA11yViolations } from './support/axe';

// CR-T21 (SPEC-CR-1 AC-10 to AC-12): the regression pass over the mobile Trade from Charts flow
// once the craft round has landed. axe (WCAG 2.2 AA) on the instrument page and the open ticket
// at a phone, a tablet and a phone in landscape; with reduced motion on, nothing on the flow slides,
// springs or rolls; and at 200% browser zoom the flow still fits and the primary actions work.
// Keyboard-only trading is covered by chartKeyboard.spec.ts and keyboardOrder.spec.ts.
//
// The page clock is fixed at Monday 28 Sep 2026, 10:00 IST, so NSE is open for the paper engine.
const MONDAY_10_IST = new Date('2026-09-28T04:30:00.000Z');

async function openInfy(page: Page) {
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
}

/** The Buy that opens the ticket: the phone's trade bar, or the header's on wider layouts. */
async function buyButton(page: Page) {
  await expect(page.getByRole('button', { name: 'Buy INFY' }).first()).toBeVisible();
  const bar = page.getByRole('group', { name: 'Trade INFY' });
  return (await bar.isVisible())
    ? bar.getByRole('button', { name: 'Buy INFY' })
    : page.getByRole('main').getByRole('button', { name: 'Buy INFY' }).first();
}

async function openTicket(page: Page) {
  await (await buyButton(page)).click();
  const ticket = page.getByRole('dialog', { name: 'Trade INFY' });
  await expect(ticket.getByRole('form', { name: 'Order details' })).toBeVisible();
  return ticket;
}

for (const screen of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'landscape phone', width: 844, height: 390 },
]) {
  test.describe(`axe on the flow, ${screen.name}`, () => {
    test.use({
      viewport: { width: screen.width, height: screen.height },
      isMobile: true,
      hasTouch: true,
    });

    test(`no serious or critical violations at ${String(screen.width)} × ${String(screen.height)}`, async ({
      page,
    }) => {
      await openInfy(page);
      await expectNoSeriousA11yViolations(page, `the instrument page, ${screen.name}`);
      await openTicket(page);
      await expectNoSeriousA11yViolations(page, `the order ticket, ${screen.name}`);
    });
  });
}

test.describe('reduced motion', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });

  test('nothing on the flow slides, springs or rolls (AC-10)', async ({ page }) => {
    await openInfy(page);
    // Finite animations still running, longer than a frame: there must be none.
    const moving = () =>
      page.evaluate(() =>
        document
          .getAnimations()
          .filter((animation) => {
            const timing = animation.effect?.getComputedTiming();
            return (
              animation.playState === 'running' &&
              timing?.iterations !== Infinity &&
              Number(timing?.duration ?? 0) > 17
            );
          })
          .map((animation) => {
            const target = (animation.effect as KeyframeEffect | null)?.target;
            return `${(animation as CSSAnimation).animationName ?? 'animation'} on ${
              target instanceof Element ? target.outerHTML.slice(0, 80) : 'unknown'
            }`;
          }),
      );
    // A price tick (the digit roll) and a page entrance.
    await page.waitForTimeout(1_500);
    expect(await moving()).toEqual([]);
    const ticket = await openTicket(page);
    expect(await moving()).toEqual([]);
    // The sheet is in place at once, not rising from below.
    const box = await ticket.boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(844 + 1);
    await page.keyboard.press('Escape');
    await expect(ticket).toBeHidden();
    expect(await moving()).toEqual([]);
  });
});

for (const zoom of [
  { name: 'a 1440 × 900 desktop', width: 720, height: 450 },
  { name: 'a 1280 × 800 laptop', width: 640, height: 400 },
]) {
  test.describe(`200% zoom on ${zoom.name}`, () => {
    test.use({ viewport: { width: zoom.width, height: zoom.height } });

    test(`the flow fits and trades at ${String(zoom.width)} × ${String(zoom.height)} CSS px`, async ({
      page,
    }) => {
      await openInfy(page);
      const sideScroll = () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      expect(await sideScroll()).toBeLessThanOrEqual(1);
      const ticket = await openTicket(page);
      expect(await sideScroll()).toBeLessThanOrEqual(1);
      const submit = ticket.getByRole('button', { name: 'Buy INFY' });
      await expect(submit).toBeInViewport();
      await submit.click();
      await expect(ticket.getByRole('heading', { name: 'Review your order' })).toBeVisible();
    });
  });
}

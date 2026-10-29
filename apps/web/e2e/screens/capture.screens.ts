import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_SEED_USER } from '@nthstock/paperEngine';
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { logIn } from '../support/auth';
import { SCREENS, VIEWPORTS, type Screen } from './screens';

// Before/after screenshots for UI pull requests (NSTOCK-0285, docs/runbooks/pr-screenshots.md).
// BEFORE_URL serves the base branch's build and AFTER_URL the PR's, both msw mode with the mock
// market open. Every screen in screens.ts is loaded on both under a fake page clock that starts at
// the same instant and only moves in steps this file controls, and Math.random is seeded (mock
// latency). The mock market is seeded too, so both sides show the same data after the same page
// time and the pixels differ only where the PR changed the UI. Each test writes its screenshots and a JSON line to SCREENS_OUT_DIR, which
// tools/github/prScreenshots.mjs turns into the PR body's Screenshots section. A screen that fails
// to load is reported in the JSON, never fails the run: the section says so instead.

/**
 * Saturday 26 Sep 2026, 10:30 IST. The market is closed (the builds leave VITE_MOCK_MARKET_OPEN
 * off), so no price ticks and every screen shows the last session's close on both sides.
 */
const FROZEN_TIME = new Date('2026-09-26T05:00:00.000Z');
/**
 * Page time to run before the first look, then per extra look. The mock market ticks every
 * 1,000 ms, so every look falls 500 ms after a tick. When one side needs more looks than the other
 * to finish loading, the quicker side is captured again with as many, so both have seen the same
 * ticks.
 */
const FIRST_LOOK_MS = 2_500;
const NEXT_LOOK_MS = 1_000;
const MAX_LOOKS = 8;
const FAKE_TIME_STEP_MS = 20;
const STEP_PAUSE_MS = 10;
/** Share of pixels that may differ before a screen counts as changed (anti-aliasing noise). */
const MAX_SAME_RATIO = 0.0005;

const SIDES = {
  before: process.env['BEFORE_URL'],
  after: process.env['AFTER_URL'],
} as const;
type Side = keyof typeof SIDES;
const OUT_DIR = process.env['SCREENS_OUT_DIR'] ?? 'screens-out';

type Capture = { png: Buffer; jpeg: Buffer; looks: number } | { error: string };

/** Logged-in storage per side, made once per worker. */
const sessions = new Map<Side, Promise<Awaited<ReturnType<BrowserContext['storageState']>>>>();

function session(browser: Browser, side: Side, baseURL: string) {
  let state = sessions.get(side);
  if (!state) {
    state = (async () => {
      const context = await browser.newContext({ baseURL });
      try {
        const page = await context.newPage();
        await page.clock.setFixedTime(FROZEN_TIME);
        await page.goto('/login?demo=1&redirect=%2Fportfolio');
        await logIn(page, DEMO_SEED_USER.mobile);
        await page.waitForURL(/\/portfolio$/);
        return await context.storageState();
      } finally {
        await context.close();
      }
    })();
    sessions.set(side, state);
  }
  return state;
}

/** Replaces Math.random with a seeded generator (mulberry32), before any page script runs. */
function seedMathRandom() {
  let state = 0x6e746873;
  Math.random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Ready, then still ready after a moment of real time (network replies that were in flight). */
async function settled(page: Page): Promise<boolean> {
  for (let check = 0; check < 20; check += 1) {
    if (await ready(page)) {
      await page.waitForTimeout(150);
      return ready(page);
    }
    await page.waitForTimeout(100);
  }
  return false;
}

/** True once the page has a heading, no loading state, fonts in and any chart painted. */
function ready(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      if (document.fonts.status !== 'loaded') return false;
      if (!document.querySelector('h1')) return false;
      if (document.querySelector('[aria-busy="true"], [role="status"][aria-label^="Loading"]')) {
        return false;
      }
      const canvases = [...document.querySelectorAll('figure canvas')].filter(
        (canvas): canvas is HTMLCanvasElement =>
          canvas instanceof HTMLCanvasElement && canvas.width > 0,
      );
      if (canvases.length === 0) return true;
      // Lightweight Charts paints on animation frames: some canvas has more than one colour.
      return canvases.some((canvas) => {
        const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
        if (!data) return false;
        for (let i = 4; i < data.length; i += 4 * 7) {
          if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) {
            return true;
          }
        }
        return false;
      });
    })
    .catch(() => false); // still navigating
}

async function capture(
  browser: Browser,
  side: Side,
  screen: Screen,
  viewport: (typeof VIEWPORTS)[number],
  minLooks = 1,
): Promise<Capture | null> {
  const baseURL = SIDES[side];
  if (!baseURL) return null;
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      baseURL,
      viewport: { width: viewport.width, height: viewport.height },
      ...(screen.authed ? { storageState: await session(browser, side, baseURL) } : {}),
    });
    const page = await context.newPage();
    await page.addInitScript(seedMathRandom);
    // Installed a minute early so pausing at FROZEN_TIME is always a jump forward.
    await page.clock.install({ time: new Date(FROZEN_TIME.getTime() - 60_000) });
    await page.clock.pauseAt(FROZEN_TIME);
    // ?demo=1 seeds the demo user's watchlists and holdings (sessionStorage, so not in the saved
    // login state); the app drops the parameter at once.
    await page.goto(screen.authed ? `${screen.path}?demo=1` : screen.path, { waitUntil: 'commit' });
    // A signed-out page starts the MSW worker after its first paint, capped by a page timer
    // (NSTOCK-0469), and the paused clock freezes both the frames and that timer. So page time
    // advances in small steps until the worker controls the page; the frozen clock alone would
    // leave the two waiting on each other.
    const mswDeadline = Date.now() + 15_000;
    while (
      !(await page.evaluate(() => navigator.serviceWorker.controller !== null).catch(() => false))
    ) {
      if (Date.now() > mswDeadline) throw new Error('the mock service worker did not start');
      await page.clock.runFor(FAKE_TIME_STEP_MS);
      await page.waitForTimeout(STEP_PAUSE_MS);
    }
    // Small steps with a pause of real time after each, so mock replies (which travel through the
    // service worker in real time) land at the same page time on both sides.
    const runFor = async (ms: number) => {
      for (let elapsed = 0; elapsed < ms; elapsed += FAKE_TIME_STEP_MS) {
        await page.clock.runFor(FAKE_TIME_STEP_MS);
        await page.waitForTimeout(STEP_PAUSE_MS);
      }
    };
    await runFor(FIRST_LOOK_MS);
    let looks = 1;
    while (looks < minLooks || !(await settled(page))) {
      if (looks >= MAX_LOOKS) throw new Error(`${screen.path} did not finish loading`);
      await runFor(NEXT_LOOK_MS);
      looks += 1;
    }
    if (new URL(page.url()).pathname !== new URL(screen.path, baseURL).pathname) {
      throw new Error(`${screen.path} redirected to ${new URL(page.url()).pathname}`);
    }
    const options = { fullPage: true, animations: 'disabled', caret: 'hide' } as const;
    const png = await page.screenshot(options);
    const jpeg = await page.screenshot({ ...options, type: 'jpeg', quality: 80 });
    return { png, jpeg, looks };
  } catch (error) {
    return {
      error:
        error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error),
    };
  } finally {
    await context?.close();
  }
}

/** Share of differing pixels between two PNGs, decoded in a blank page (no extra dependencies). */
async function pixelDiffRatio(browser: Browser, a: Buffer, b: Buffer): Promise<number> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([first, second]) => {
        const decode = async (base64: string) => {
          const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
          const bitmap = await createImageBitmap(blob);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no 2d context');
          context.drawImage(bitmap, 0, 0);
          return context.getImageData(0, 0, bitmap.width, bitmap.height);
        };
        const [x, y] = await Promise.all([decode(first), decode(second)]);
        if (x.width !== y.width || x.height !== y.height) return 1;
        let differing = 0;
        for (let i = 0; i < x.data.length; i += 4) {
          if (
            x.data[i] !== y.data[i] ||
            x.data[i + 1] !== y.data[i + 1] ||
            x.data[i + 2] !== y.data[i + 2]
          ) {
            differing += 1;
          }
        }
        return differing / (x.width * x.height);
      },
      [a.toString('base64'), b.toString('base64')] as const,
    );
  } finally {
    await page.close();
  }
}

for (const [screenIndex, screen] of SCREENS.entries()) {
  for (const [viewportIndex, viewport] of VIEWPORTS.entries()) {
    const id = `${screen.name}-${String(viewport.width)}`;
    test(id, async ({ browser }) => {
      test.setTimeout(150_000);
      let before = await capture(browser, 'before', screen, viewport);
      let after = await capture(browser, 'after', screen, viewport);
      if (before && after && 'looks' in before && 'looks' in after) {
        if (before.looks < after.looks) {
          before = await capture(browser, 'before', screen, viewport, after.looks);
        } else if (after.looks < before.looks) {
          after = await capture(browser, 'after', screen, viewport, before.looks);
        }
      }
      const result: Record<string, unknown> = {
        id,
        order: screenIndex * VIEWPORTS.length + viewportIndex,
        name: screen.name,
        path: screen.path,
        viewport: viewport.label,
        width: viewport.width,
      };
      for (const [side, shot] of [
        ['before', before],
        ['after', after],
      ] as const) {
        if (!shot) continue;
        if ('error' in shot) {
          result[`${side}Error`] = shot.error;
          continue;
        }
        mkdirSync(join(OUT_DIR, side), { recursive: true });
        writeFileSync(join(OUT_DIR, side, `${id}.jpg`), shot.jpeg);
        result[side] = `${side}/${id}.jpg`;
      }
      if (before && after && 'png' in before && 'png' in after) {
        result['looks'] = [before.looks, after.looks];
        const ratio = await pixelDiffRatio(browser, before.png, after.png);
        result['diffRatio'] = ratio;
        result['changed'] = ratio > MAX_SAME_RATIO;
      } else {
        // Only one side rendered: a new screen, a removed one, or a failure on one side.
        result['changed'] = Boolean(result['before']) !== Boolean(result['after']);
      }
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(join(OUT_DIR, `${id}.json`), JSON.stringify(result));
    });
  }
}

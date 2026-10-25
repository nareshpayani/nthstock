import type { Locator, Page } from '@playwright/test';

// On-screen narration for the walkthrough videos (docs/runbooks/demo-walkthrough.md): a caption
// bar at the top of the page and a dot where each tap or click lands, so a clip reads without
// sound. Both are drawn over the page with pointer-events: none, so they never change what the
// test drives.

export type Point = { x: number; y: number };

const started = Date.now();

/** Each page's captions with their times, for the clip's WebVTT track (see `captionsOf`). */
const cues = new WeakMap<Page, { start: number; lines: { at: number; text: string }[] }>();

/** Starts timing a page's captions from now, which is about when its video starts. */
export function startCaptions(page: Page): void {
  cues.set(page, { start: Date.now(), lines: [] });
}

const stamp = (ms: number) => {
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(total % 1000, 3)}`;
};

/**
 * The page's captions as WebVTT, one cue per caption until the next one, so the guide's players
 * carry a captions track (WCAG 1.2.2) with the same words as the caption bar.
 */
export function captionsOf(page: Page): string {
  const log = cues.get(page);
  if (!log) throw new Error('startCaptions was not called for this page');
  const end = Date.now();
  const lines = log.lines;
  const body = lines
    .map((line, index) => ({ ...line, until: lines[index + 1]?.at ?? end }))
    .filter((line) => line.text)
    .map((line, index) =>
      [
        String(index + 1),
        `${stamp(line.at - log.start)} --> ${stamp(line.until - log.start)}`,
        line.text,
      ].join('\n'),
    );
  return ['WEBVTT', ...body].join('\n\n') + '\n';
}

/** A caption bar, drawn once per document (a navigation removes it, so `say` adds it again). */
async function installOverlay(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById('walkthrough-caption')) return;
    const caption = document.createElement('div');
    caption.id = 'walkthrough-caption';
    const wide = window.innerWidth >= 768;
    Object.assign(caption.style, {
      position: 'fixed',
      left: wide ? '50%' : '8px',
      right: wide ? 'auto' : '8px',
      transform: wide ? 'translateX(-50%)' : 'none',
      maxWidth: wide ? '880px' : 'none',
      top: wide ? 'auto' : '8px',
      bottom: wide ? '24px' : 'auto',
      zIndex: '2147483647',
      pointerEvents: 'none',
      padding: wide ? '12px 20px' : '8px 12px',
      borderRadius: '10px',
      background: 'rgba(15, 23, 42, 0.88)',
      color: '#fff',
      font: wide ? '600 18px/1.4 system-ui, sans-serif' : '600 14px/1.35 system-ui, sans-serif',
      textAlign: wide ? 'center' : 'left',
      transition: 'opacity 200ms',
      opacity: '0',
    });
    document.body.append(caption);
  });
}

/** Shows `text` as the caption (an empty string hides it) and holds it for `holdMs`. */
export async function say(page: Page, text: string, holdMs = 2200): Promise<void> {
  if (process.env['WALKTHROUGH_TIMING']) {
    console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${text}`);
  }
  cues.get(page)?.lines.push({ at: Date.now(), text });
  await installOverlay(page);
  await page.evaluate((value) => {
    const caption = document.getElementById('walkthrough-caption');
    if (!caption) return;
    caption.textContent = value;
    caption.style.opacity = value ? '1' : '0';
  }, text);
  await page.waitForTimeout(holdMs);
}

/** A dot that fades out where a finger or the pointer lands. */
export async function dot(page: Page, at: Point): Promise<void> {
  await page.evaluate(({ x, y }) => {
    const mark = document.createElement('div');
    Object.assign(mark.style, {
      position: 'fixed',
      left: `${String(x - 18)}px`,
      top: `${String(y - 18)}px`,
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'rgba(20, 99, 216, 0.35)',
      border: '2px solid rgba(20, 99, 216, 0.9)',
      zIndex: '2147483646',
      pointerEvents: 'none',
      transition: 'opacity 600ms',
    });
    document.body.append(mark);
    setTimeout(() => (mark.style.opacity = '0'), 500);
    setTimeout(() => mark.remove(), 1200);
  }, at);
}

async function centre(target: Locator): Promise<Point> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('the target has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Pointer actions for a desktop clip: each click shows a dot first, and typing goes in at a
 * readable speed instead of all at once.
 */
export function pointer(page: Page) {
  return {
    click: async (target: Locator, pauseMs = 600) => {
      const at = await centre(target);
      await page.mouse.move(at.x, at.y, { steps: 6 });
      await dot(page, at);
      await target.click();
      await page.waitForTimeout(pauseMs);
    },
    clickAt: async (at: Point, pauseMs = 600) => {
      await page.mouse.move(at.x, at.y, { steps: 6 });
      await dot(page, at);
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(pauseMs);
    },
    hover: async (target: Locator, pauseMs = 600) => {
      const at = await centre(target);
      await page.mouse.move(at.x, at.y, { steps: 8 });
      await page.waitForTimeout(pauseMs);
    },
    drag: async (from: Point, to: Point, pauseMs = 700) => {
      await page.mouse.move(from.x, from.y, { steps: 6 });
      await dot(page, from);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 16 });
      await page.mouse.up();
      await dot(page, to);
      await page.waitForTimeout(pauseMs);
    },
    /** Replaces a field's text, typed key by key. */
    type: async (field: Locator, text: string, pauseMs = 400) => {
      const at = await centre(field);
      await dot(page, at);
      await field.fill('');
      await field.pressSequentially(text, { delay: 70 });
      await page.waitForTimeout(pauseMs);
    },
    /** Types into whatever has focus (one-digit OTP and PIN boxes move focus themselves). */
    keys: async (text: string, pauseMs = 400) => {
      await page.keyboard.type(text, { delay: 90 });
      await page.waitForTimeout(pauseMs);
    },
    press: async (key: string, pauseMs = 600) => {
      await page.keyboard.press(key);
      await page.waitForTimeout(pauseMs);
    },
    centre,
  };
}

/** Touch actions for a phone clip: a dot, then a tap where the finger lands. */
export function finger(page: Page) {
  return {
    tap: async (target: Locator, pauseMs = 700) => {
      const at = await centre(target);
      await dot(page, at);
      await target.tap();
      await page.waitForTimeout(pauseMs);
    },
    /** For sticky bars and pads: tapped where they are, with no scroll first. */
    tapInPlace: async (target: Locator, pauseMs = 700) => {
      const box = await target.boundingBox();
      if (!box) throw new Error('the target has no box');
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await dot(page, at);
      await page.touchscreen.tap(at.x, at.y);
      await page.waitForTimeout(pauseMs);
    },
    type: async (field: Locator, text: string, pauseMs = 400) => {
      await dot(page, await centre(field));
      await field.fill('');
      await field.pressSequentially(text, { delay: 70 });
      await page.waitForTimeout(pauseMs);
    },
    /** Scrolls the page by `dy` pixels, smoothly, as a swipe would. */
    scroll: async (dy: number, pauseMs = 900) => {
      await page.evaluate((by) => window.scrollBy({ top: by, behavior: 'smooth' }), dy);
      await page.waitForTimeout(pauseMs);
    },
  };
}

/** Rupees in a label such as "Buy 4 @ ₹1,234.55", as a number. */
export const rupees = (text: string): number => {
  const match = /₹([\d,]+\.\d\d)/.exec(text);
  if (!match?.[1]) throw new Error(`no price in "${text}"`);
  return Number(match[1].replaceAll(',', ''));
};

/** A number as the app shows rupees: "₹1,234.50". */
export const inr = (value: number): string =>
  `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

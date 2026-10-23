import type { CDPSession, Locator, Page } from '@playwright/test';

// Touch input for the @touch specs (T04, SPEC-TFC-1 §9.1, §13). On Chromium it sends real touch
// events through the DevTools protocol, so the page sees touchstart, pointerdown with pointerType
// "touch", and the browser's own gesture handling, including two fingers for a pinch. Playwright
// offers WebKit only a single-tap touchscreen, so there a press and a drag go through the mouse
// (the same pointer events and pointer capture, as pointerType "mouse"), and `multiTouch` is false.

export type Point = { x: number; y: number };

export type Finger = {
  /** Moves the finger to `to` in `steps` even moves. */
  move: (to: Point, steps?: number) => Promise<void>;
  /** Puts a second finger down at `at`, then lifts both: the "second finger cancels" rule. */
  addFinger: (at: Point) => Promise<void>;
  release: () => Promise<void>;
};

export type Touch = {
  /** True when two fingers can be down at once (Chromium). */
  multiTouch: boolean;
  tap: (at: Point) => Promise<void>;
  press: (at: Point) => Promise<Finger>;
  drag: (from: Point, to: Point, steps?: number) => Promise<void>;
  longPress: (at: Point, ms?: number) => Promise<void>;
  /** Two fingers around `center`, `fromGap` apart, moving to `toGap` apart. Chromium only. */
  pinch: (center: Point, fromGap: number, toGap: number, steps?: number) => Promise<void>;
};

const LONG_PRESS_MS = 700;

/**
 * The centre of an element, for a tap or the start of a drag. The element is scrolled to the
 * middle of the screen first, clear of the sticky trade bar and the toasts at the bottom, which a
 * plain scroll into view can leave on top of it on a short phone.
 */
export async function centreOf(locator: Locator): Promise<Point> {
  await locator.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest' }),
  );
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('element has no box');
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

const between = (from: Point, to: Point, t: number): Point => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

type TouchPoint = Point & { id: number };

function cdpTouch(page: Page, session: CDPSession): Touch {
  const send = (
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    touchPoints: TouchPoint[],
  ) => session.send('Input.dispatchTouchEvent', { type, touchPoints });

  const press = async (at: Point): Promise<Finger> => {
    let current = at;
    await send('touchStart', [{ ...at, id: 0 }]);
    return {
      move: async (to, steps = 5) => {
        const from = current;
        for (let i = 1; i <= steps; i += 1) {
          current = between(from, to, i / steps);
          await send('touchMove', [{ ...current, id: 0 }]);
        }
      },
      addFinger: async (second) => {
        await send('touchStart', [
          { ...current, id: 0 },
          { ...second, id: 1 },
        ]);
        await send('touchEnd', [{ ...current, id: 0 }]);
        await send('touchEnd', []);
      },
      release: () => send('touchEnd', []).then(() => undefined),
    };
  };

  return {
    multiTouch: true,
    tap: async (at) => {
      const finger = await press(at);
      await finger.release();
    },
    press,
    drag: async (from, to, steps = 8) => {
      const finger = await press(from);
      await finger.move(to, steps);
      await finger.release();
    },
    longPress: async (at, ms = LONG_PRESS_MS) => {
      const finger = await press(at);
      await page.waitForTimeout(ms);
      await finger.release();
    },
    pinch: async (center, fromGap, toGap, steps = 8) => {
      const fingers = (gap: number): TouchPoint[] => [
        { x: center.x - gap / 2, y: center.y, id: 0 },
        { x: center.x + gap / 2, y: center.y, id: 1 },
      ];
      await send('touchStart', fingers(fromGap));
      for (let i = 1; i <= steps; i += 1) {
        await send('touchMove', fingers(fromGap + ((toGap - fromGap) * i) / steps));
      }
      await send('touchEnd', []);
    },
  };
}

function mouseTouch(page: Page): Touch {
  const press = async (at: Point): Promise<Finger> => {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    return {
      move: (to, steps = 5) => page.mouse.move(to.x, to.y, { steps }),
      addFinger: () => {
        throw new Error('a second finger needs Chromium (multiTouch)');
      },
      release: () => page.mouse.up(),
    };
  };
  return {
    multiTouch: false,
    tap: (at) => page.touchscreen.tap(at.x, at.y),
    press,
    drag: async (from, to, steps = 8) => {
      const finger = await press(from);
      await finger.move(to, steps);
      await finger.release();
    },
    longPress: async (at, ms = LONG_PRESS_MS) => {
      const finger = await press(at);
      await page.waitForTimeout(ms);
      await finger.release();
    },
    pinch: () => {
      throw new Error('a pinch needs Chromium (multiTouch)');
    },
  };
}

/** Touch input for `page`: real touch events on Chromium, the closest Playwright allows on WebKit. */
export async function touchscreen(page: Page): Promise<Touch> {
  const name = page.context().browser()?.browserType().name();
  if (name === 'chromium') return cdpTouch(page, await page.context().newCDPSession(page));
  return mouseTouch(page);
}

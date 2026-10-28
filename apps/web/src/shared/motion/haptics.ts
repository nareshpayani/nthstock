import { safeStorage } from '../lib/safeStorage';

/**
 * Haptic hooks for the chart drag and the order sheet (SPEC-CR-1 §5.4). The patterns follow
 * Apple's three meanings (impact, selection, notification) so they read as native on both
 * platforms. They never carry meaning alone: every event they mark is also visible and announced.
 *
 * Android Chrome and Samsung Internet: `navigator.vibrate`. iPhone Safari has no Vibration API, so
 * there a tap on a hidden native switch (`<input type="checkbox" switch>`, Safari 17.4+) gives one
 * light tick per call, behind `IPHONE_SWITCH_HAPTICS` (CR-09). Both need a user gesture in flight,
 * which every caller here has (a drag or a tap). The user can turn haptics off (`setHapticsEnabled`).
 */
export type HapticEvent = 'grab' | 'tick' | 'crossLtp' | 'commit' | 'reject';

/** Vibration patterns in ms (on, off, on…), from §5.4. */
export const HAPTIC_PATTERNS: Readonly<Record<HapticEvent, number | readonly number[]>> = {
  grab: 10,
  tick: 4,
  crossLtp: 18,
  commit: [12, 40, 12],
  reject: [30, 30, 30],
};

/** Selection ticks while dragging fire at most once per 40 ms, so a fast drag doesn't buzz. */
export const TICK_THROTTLE_MS = 40;

/** Flag for the iPhone switch workaround (CR-09): off turns iPhone haptics off, Android stays. */
export const IPHONE_SWITCH_HAPTICS = true;

const STORAGE_KEY = 'nthstock.haptics';

export function hapticsEnabled(): boolean {
  return safeStorage.get(STORAGE_KEY) !== 'off';
}

export function setHapticsEnabled(enabled: boolean): void {
  if (enabled) safeStorage.remove(STORAGE_KEY);
  else safeStorage.set(STORAGE_KEY, 'off');
}

let lastTickAt = Number.NEGATIVE_INFINITY;
let iphoneSwitch: HTMLLabelElement | undefined;

/** The hidden switch whose toggle makes iPhone Safari tick. Made once, on first use. */
function switchLabel(): HTMLLabelElement {
  if (iphoneSwitch?.isConnected) return iphoneSwitch;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText =
    'position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);opacity:0;pointer-events:none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.append(input);
  document.body.append(label);
  iphoneSwitch = label;
  return label;
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** iPhone and iPad Safari (iPadOS reports a Mac with touch). */
function isAppleTouch(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  );
}

/**
 * Plays the haptic for `event` where the device supports one; does nothing where it doesn't, when
 * the user turned haptics off, or (for `tick`) inside the throttle window. Returns whether it fired.
 */
export function haptic(event: HapticEvent, now: number = performance.now()): boolean {
  if (!hapticsEnabled()) return false;
  if (event === 'tick') {
    if (now - lastTickAt < TICK_THROTTLE_MS) return false;
    lastTickAt = now;
  }
  if (canVibrate()) {
    const pattern = HAPTIC_PATTERNS[event];
    return navigator.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
  }
  if (IPHONE_SWITCH_HAPTICS && isAppleTouch()) {
    switchLabel().click();
    return true;
  }
  return false;
}

/** Test seam: forget the throttle and the hidden switch. */
export function resetHapticsForTests(): void {
  lastTickAt = Number.NEGATIVE_INFINITY;
  iphoneSwitch?.remove();
  iphoneSwitch = undefined;
}

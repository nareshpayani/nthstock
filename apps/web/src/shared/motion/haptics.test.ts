import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  haptic,
  HAPTIC_PATTERNS,
  hapticsEnabled,
  resetHapticsForTests,
  setHapticsEnabled,
  TICK_THROTTLE_MS,
} from './haptics';

describe('haptics (SPEC-CR-1 §5.4)', () => {
  let vibrate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, vibrate, userAgent: 'Android', maxTouchPoints: 5 });
    window.localStorage.clear();
    resetHapticsForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays each event with its pattern on Android', () => {
    haptic('grab', 0);
    haptic('commit', 100);
    haptic('reject', 200);
    expect(vibrate.mock.calls).toEqual([[HAPTIC_PATTERNS.grab], [[12, 40, 12]], [[30, 30, 30]]]);
  });

  it('throttles selection ticks to one per 40 ms', () => {
    expect(haptic('tick', 0)).toBe(true);
    expect(haptic('tick', TICK_THROTTLE_MS - 1)).toBe(false);
    expect(haptic('tick', TICK_THROTTLE_MS)).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('never fires when the user turned haptics off', () => {
    setHapticsEnabled(false);
    expect(hapticsEnabled()).toBe(false);
    expect(haptic('grab', 0)).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    setHapticsEnabled(true);
    expect(haptic('grab', 10)).toBe(true);
  });

  it('ticks a hidden native switch on iPhone, which has no Vibration API', () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone', maxTouchPoints: 5 });
    const clicks = vi.fn();
    document.addEventListener('click', clicks);
    expect(haptic('grab', 0)).toBe(true);
    const input = document.querySelector('input[switch]');
    expect(input).not.toBeNull();
    expect(input?.closest('label')?.getAttribute('aria-hidden')).toBe('true');
    expect(clicks).toHaveBeenCalled();
    document.removeEventListener('click', clicks);
  });

  it('does nothing on a desktop browser with neither', () => {
    vi.stubGlobal('navigator', { userAgent: 'Windows', maxTouchPoints: 0 });
    expect(haptic('grab', 0)).toBe(false);
    expect(document.querySelector('input[switch]')).toBeNull();
  });
});

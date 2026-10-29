import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHapticsForTests } from './haptics';
import { fillCue, orderCue, SUCCESS_HOLD_MS, useSuccessHold } from './orderCues';

describe('order cues (A17)', () => {
  let vibrate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, vibrate, userAgent: 'Android', maxTouchPoints: 5 });
    window.localStorage.clear();
    resetHapticsForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('gives a success haptic for an outcome and an error one for a refusal', () => {
    orderCue('placed');
    orderCue('rejected');
    expect(vibrate.mock.calls).toEqual([[[12, 40, 12]], [[30, 30, 30]]]);
  });

  it('picks a rising cue for a buy fill and a falling one for a sell fill', () => {
    expect(fillCue('BUY')).toBe('filledBuy');
    expect(fillCue('SELL')).toBe('filledSell');
  });

  it('holds the tick, then runs the close; unmounting first cancels it', () => {
    vi.useFakeTimers();
    const then = vi.fn();
    const { result, unmount } = renderHook(() => useSuccessHold());
    act(() => result.current[1](then));
    expect(result.current[0]).toBe(true);
    act(() => vi.advanceTimersByTime(SUCCESS_HOLD_MS - 1));
    expect(then).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(then).toHaveBeenCalledOnce();

    const later = vi.fn();
    const second = renderHook(() => useSuccessHold());
    act(() => second.result.current[1](later));
    second.unmount();
    act(() => vi.advanceTimersByTime(SUCCESS_HOLD_MS));
    expect(later).not.toHaveBeenCalled();
    unmount();
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_DISARM_MS, useArming } from './useArming';

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('arming (T22, SPEC-TFC-1 §11.3)', () => {
  it('starts disarmed and arms when asked', () => {
    const { result } = renderHook(() => useArming(408065));
    expect(result.current.armed).toBe(false);
    act(() => result.current.setArmed(true));
    expect(result.current.armed).toBe(true);
    act(() => result.current.setArmed(false));
    expect(result.current.armed).toBe(false);
  });

  it('disarms after 2 minutes without a trade, and each trade restarts the 2 minutes', () => {
    const onDisarm = vi.fn();
    const { result } = renderHook(() => useArming(408065, onDisarm));
    act(() => result.current.setArmed(true));
    act(() => vi.advanceTimersByTime(IDLE_DISARM_MS - 1_000));
    act(() => result.current.noteTrade());
    act(() => vi.advanceTimersByTime(IDLE_DISARM_MS - 1_000));
    expect(result.current.armed).toBe(true);
    expect(onDisarm).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.armed).toBe(false);
    expect(onDisarm).toHaveBeenCalledWith('idle');
  });

  it('disarms when the page is hidden, and stays disarmed when it comes back', () => {
    const onDisarm = vi.fn();
    const { result } = renderHook(() => useArming(408065, onDisarm));
    act(() => result.current.setArmed(true));
    act(() => setVisibility('hidden'));
    expect(result.current.armed).toBe(false);
    expect(onDisarm).toHaveBeenCalledWith('hidden');
    act(() => setVisibility('visible'));
    expect(result.current.armed).toBe(false);
  });

  it('disarms when the pad moves to another instrument', () => {
    const { result, rerender } = renderHook(({ token }) => useArming(token), {
      initialProps: { token: 408065 },
    });
    act(() => result.current.setArmed(true));
    rerender({ token: 2885 });
    expect(result.current.armed).toBe(false);
    // Coming back does not re-arm either.
    rerender({ token: 408065 });
    expect(result.current.armed).toBe(false);
  });

  it('a disarmed pad has no idle timer running', () => {
    const onDisarm = vi.fn();
    renderHook(() => useArming(408065, onDisarm));
    act(() => vi.advanceTimersByTime(IDLE_DISARM_MS * 2));
    expect(onDisarm).not.toHaveBeenCalled();
  });
});

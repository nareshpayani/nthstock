import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedValue', () => {
  it('updates only after the value has held still for the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 150), {
      initialProps: { value: 'i' },
    });
    expect(result.current).toBe('i');

    rerender({ value: 'in' });
    act(() => vi.advanceTimersByTime(100));
    rerender({ value: 'inf' });
    act(() => vi.advanceTimersByTime(100));
    // 200 ms since the first change, but only 100 ms since the last one.
    expect(result.current).toBe('i');

    act(() => vi.advanceTimersByTime(50));
    expect(result.current).toBe('inf');
  });
});

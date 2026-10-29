import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCountedValue } from './useCountedValue';

describe('useCountedValue (A15)', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the first value at once, then counts through whole values to the next', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const { result, rerender } = renderHook(({ value }) => useCountedValue(value, 300), {
      initialProps: { value: 1000 },
    });
    expect(result.current).toBe(1000);
    rerender({ value: 2000 });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.current).toBeGreaterThan(1000);
    expect(result.current).toBeLessThan(2000);
    expect(Number.isInteger(result.current)).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(result.current).toBe(2000);
  });

  it('jumps straight to the value under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { result, rerender } = renderHook(({ value }) => useCountedValue(value), {
      initialProps: { value: 5 },
    });
    rerender({ value: 9 });
    expect(result.current).toBe(9);
    vi.unstubAllGlobals();
  });
});

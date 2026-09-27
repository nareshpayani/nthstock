import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setPageVisibility } from '@/test/intersectionObserver';
import { usePageVisible } from './usePageVisible';

afterEach(() => {
  setPageVisibility('visible');
});

describe('usePageVisible', () => {
  it('follows document visibility', () => {
    const { result } = renderHook(() => usePageVisible());
    expect(result.current).toBe(true);
    act(() => setPageVisibility('hidden'));
    expect(result.current).toBe(false);
    act(() => setPageVisibility('visible'));
    expect(result.current).toBe(true);
  });
});

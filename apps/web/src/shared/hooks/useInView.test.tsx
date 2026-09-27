import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installIntersectionObserver } from '@/test/intersectionObserver';
import { useInView } from './useInView';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useInView', () => {
  it('starts in view and follows the observer, disconnecting on unmount', () => {
    const io = installIntersectionObserver();
    const ref = { current: document.createElement('div') };
    const { result, unmount } = renderHook(() => useInView(ref));
    expect(result.current).toBe(true);
    expect(io.observed()).toEqual([ref.current]);
    act(() => io.setInView(false));
    expect(result.current).toBe(false);
    act(() => io.setInView(true));
    expect(result.current).toBe(true);
    unmount();
    expect(io.observed()).toHaveLength(0);
  });

  it('stays in view without IntersectionObserver or an element', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const ref = { current: document.createElement('div') };
    expect(renderHook(() => useInView(ref)).result.current).toBe(true);
    expect(renderHook(() => useInView({ current: null })).result.current).toBe(true);
  });
});

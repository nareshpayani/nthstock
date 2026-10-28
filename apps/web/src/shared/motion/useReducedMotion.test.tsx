import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion, useReducedMotion } from './useReducedMotion';

function mockMatchMedia(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe('useReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows prefers-reduced-motion', () => {
    mockMatchMedia(true);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);
    expect(prefersReducedMotion()).toBe(true);
    mockMatchMedia(false);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
    expect(prefersReducedMotion()).toBe(false);
  });
});

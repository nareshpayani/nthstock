import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePhoneLayout, usePhoneShell } from './usePhoneLayout';

/** A matchMedia that answers for a window of this size, as a browser would for these queries. */
function stubWindow(width: number, height: number) {
  const matches = (query: string) =>
    query.split(',').some((part) => {
      const max = /max-width:\s*([\d.]+)px/.exec(part);
      const maxH = /max-height:\s*([\d.]+)px/.exec(part);
      const min = /min-width:\s*([\d.]+)px/.exec(part);
      return (
        (!max || width <= Number(max[1])) &&
        (!maxH || height <= Number(maxH[1])) &&
        (!min || width >= Number(min[1]))
      );
    });
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: matches(query),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePhoneShell (NSTOCK-0466)', () => {
  it.each([
    [320, 640, true],
    [390, 844, true],
    [767, 1024, true],
    [768, 1024, false],
    [1440, 900, false],
  ])('at %i × %i px is %s', (width, height, expected) => {
    stubWindow(width, height);
    expect(renderHook(() => usePhoneShell()).result.current).toBe(expected);
  });

  it('keeps the drawer for a phone in landscape, which still gets the phone page layout', () => {
    stubWindow(844, 390);
    expect(renderHook(() => usePhoneShell()).result.current).toBe(false);
    expect(renderHook(() => usePhoneLayout()).result.current).toBe(true);
  });
});

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePanelPlacement } from './panelPlacement';

vi.mock('@/shared/hooks/useSession', () => ({ useSession: () => ({ status: 'authenticated' }) }));

const DESKTOP = 'w-[440px]';

/** A screen of the given size; `coarse` is a touch screen. */
function screenOf(width: number, height: number, coarse = true) {
  const matches = (query: string) =>
    query.split(',').some((part) =>
      part.split(' and ').every((feature) => {
        const [, name, value] = /\(([\w-]+):\s*([^)]+)\)/.exec(feature) ?? [];
        const px = Number.parseFloat(value ?? '');
        if (name === 'max-width') return width <= px;
        if (name === 'min-width') return width >= px;
        if (name === 'max-height') return height <= px;
        if (name === 'min-height') return height >= px;
        if (name === 'pointer') return coarse === (value === 'coarse');
        return false;
      }),
    );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches(query),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('where a trading panel opens (SPEC-CR-1 §6.2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rises from the bottom on a phone', () => {
    screenOf(390, 844);
    expect(renderHook(() => usePanelPlacement(DESKTOP)).result.current).toEqual({
      side: 'bottom',
    });
  });

  it('takes the full height on a phone in landscape', () => {
    screenOf(844, 390);
    const { result } = renderHook(() => usePanelPlacement(DESKTOP));
    expect(result.current.side).toBe('bottom');
    expect(result.current.className).toContain('h-dvh');
  });

  it.each([
    [673, 841],
    [820, 1180],
    [1000, 700],
  ])('docks beside the page at %i × %i', (width, height) => {
    screenOf(width, height);
    expect(renderHook(() => usePanelPlacement(DESKTOP)).result.current).toEqual({
      side: 'right',
      docked: true,
    });
  });

  it('slides over from the right from 1024 px, touch-sized on a tablet only', () => {
    screenOf(1180, 820);
    expect(renderHook(() => usePanelPlacement(DESKTOP)).result.current).toEqual({
      side: 'right',
      className: DESKTOP,
      touchSize: true,
    });
    screenOf(1440, 900, false);
    expect(renderHook(() => usePanelPlacement(DESKTOP)).result.current.touchSize).toBe(false);
  });
});

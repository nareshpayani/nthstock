import { vi } from 'vitest';

/**
 * A touch screen for hooks that read `matchMedia`: only the coarse-pointer query matches. Undo it
 * with `vi.unstubAllGlobals()`.
 */
export function stubTouchScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('pointer: coarse'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

import { vi } from 'vitest';

/** A touch screen: only the coarse-pointer query matches. Undo with `vi.unstubAllGlobals()`. */
export function touchScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('pointer: coarse'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

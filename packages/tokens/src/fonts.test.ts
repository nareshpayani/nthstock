import { describe, expect, it } from 'vitest';
import { fontFiles, toFontFaces } from './fonts.js';

describe('toFontFaces', () => {
  const css = toFontFaces();

  it('declares every font file as woff2 with font-display swap and no remote URLs', () => {
    expect(css.match(/@font-face/g)).toHaveLength(fontFiles.length);
    expect(css.match(/font-display: swap;/g)).toHaveLength(fontFiles.length);
    expect(css).not.toMatch(/https?:/);
    expect(css).not.toContain(".woff'");
    expect(css).toContain("url('./fonts/ibm-plex-sans-latin-400-normal.woff2') format('woff2')");
  });

  it('ships Plex Sans 400/500/600 and Plex Mono 500, latin only', () => {
    expect(fontFiles.map((f) => `${f.family} ${String(f.weight)}`)).toEqual([
      'IBM Plex Sans 400',
      'IBM Plex Sans 500',
      'IBM Plex Sans 600',
      'IBM Plex Mono 500',
    ]);
    expect(fontFiles.every((f) => f.file.includes('-latin-'))).toBe(true);
  });
});

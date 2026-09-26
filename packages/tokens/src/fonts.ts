/**
 * Self-hosted IBM Plex (SIL Open Font License 1.1, from @fontsource). Latin subset, woff2 only
 * (Chrome only, D4). Mono ships one weight (500) and is used for prices and ids; the browser uses
 * the nearest weight for anything else.
 */
export type FontFile = { family: string; weight: number; source: string; file: string };

const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

export const fontFiles: readonly FontFile[] = [
  ...[400, 500, 600].map((weight) => ({
    family: 'IBM Plex Sans',
    weight,
    source: '@fontsource/ibm-plex-sans',
    file: `ibm-plex-sans-latin-${String(weight)}-normal.woff2`,
  })),
  {
    family: 'IBM Plex Mono',
    weight: 500,
    source: '@fontsource/ibm-plex-mono',
    file: 'ibm-plex-mono-latin-500-normal.woff2',
  },
];

/** @font-face rules pointing at ./fonts/<file>, with font-display: swap. */
export function toFontFaces(files: readonly FontFile[] = fontFiles): string {
  const faces = files.map(
    (font) => `@font-face {
  font-family: '${font.family}';
  font-style: normal;
  font-weight: ${String(font.weight)};
  font-display: swap;
  src: url('./fonts/${font.file}') format('woff2');
  unicode-range: ${LATIN_RANGE};
}
`,
  );
  return `/* Generated from packages/tokens/src/fonts.ts. Do not edit by hand. */\n${faces.join('')}`;
}

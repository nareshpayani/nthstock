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

/**
 * Metric-matched fallbacks (CR-T19): a local system face resized and re-spaced to IBM Plex, so text
 * set in the fallback during the swap occupies the same box and nothing jumps when Plex arrives.
 * Values are percentages, measured from the woff2 files with fontTools against Arial / Liberation
 * Sans and Courier New / Liberation Mono: Plex sets 1025/275 ascent/descent on a 1000 em; sans
 * advance widths average 101% of Arial over UI copy, mono advances match exactly (0.6 em).
 */
export type FallbackFace = {
  family: string;
  locals: readonly string[];
  sizeAdjust: number;
  ascent: number;
  descent: number;
};

export const fallbackFaces: readonly FallbackFace[] = [
  {
    family: 'IBM Plex Sans Fallback',
    locals: ['Arial', 'Liberation Sans', 'Helvetica'],
    sizeAdjust: 101,
    ascent: 101.5,
    descent: 27.2,
  },
  {
    family: 'IBM Plex Mono Fallback',
    locals: ['Courier New', 'Liberation Mono', 'Menlo'],
    sizeAdjust: 100,
    ascent: 102.5,
    descent: 27.5,
  },
];

/**
 * @font-face rules pointing at ./fonts/<file>, with font-display: swap, followed by the
 * metric-matched fallback faces.
 */
export function toFontFaces(
  files: readonly FontFile[] = fontFiles,
  fallbacks: readonly FallbackFace[] = fallbackFaces,
): string {
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
  const fallbackRules = fallbacks.map(
    (face) => `@font-face {
  font-family: '${face.family}';
  src: ${face.locals.map((name) => `local('${name}')`).join(', ')};
  size-adjust: ${String(face.sizeAdjust)}%;
  ascent-override: ${String(face.ascent)}%;
  descent-override: ${String(face.descent)}%;
  line-gap-override: 0%;
}
`,
  );
  return `/* Generated from packages/tokens/src/fonts.ts. Do not edit by hand. */\n${[...faces, ...fallbackRules].join('')}`;
}

/**
 * nthstock design tokens: the single source for tokens.css (CSS variables) and the Tailwind theme.
 * One light theme only (CLAUDE.md D4). Approved by the owner on 2026-09-25.
 * Palette variant "closer" (2026-09-26): bright blue primary on white, deep navy ink.
 * nthstock's own values; deliberately far from any third-party brand colour.
 * Marigold is a fill colour only (focus rings, pills, highlights) and never used for text.
 */

export const colors = {
  brand: '#1463D8',
  'brand-soft': '#E8F1FD',
  marigold: '#F2B632',
  'marigold-soft': '#FDF3DC',
  up: '#0B7A52',
  'up-soft': '#E3F3EC',
  down: '#C0392B',
  'down-soft': '#FBE9E7',
  ink: '#0E2240',
  'ink-muted': '#5A6B80',
  canvas: '#F3F6FA',
  line: '#DCE3ED',
  surface: '#FFFFFF',
} as const;

export type ColorName = keyof typeof colors;

/** Colours that are used for text and must reach 4.5:1 on surface and canvas. */
export const textColors = [
  'ink',
  'ink-muted',
  'brand',
  'up',
  'down',
] as const satisfies readonly ColorName[];

export const fonts = {
  sans: "'IBM Plex Sans', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
} as const;

export type TypeStep = { size: number; lineHeight: number; weight: number };

/** Type scale in px: 32 / 20 / 16 / 14 / 12. */
export const typeScale = {
  display: { size: 32, lineHeight: 40, weight: 600 },
  title: { size: 20, lineHeight: 28, weight: 600 },
  lg: { size: 16, lineHeight: 24, weight: 500 },
  body: { size: 14, lineHeight: 20, weight: 400 },
  label: { size: 12, lineHeight: 16, weight: 500 },
} as const satisfies Record<string, TypeStep>;

/** Spacing steps in px. Tailwind's spacing unit is 4 px, so p-1 … p-12 map onto these. */
export const spacing = [4, 8, 12, 16, 24, 32, 48] as const;
export const spacingUnit = 4;

export const radius = { sm: 4, md: 8, lg: 12, pill: 9999 } as const;

/** Cards use borders, not shadows. One shadow for menus and overlays, one hairline for raised chips. */
export const shadows = {
  raised: '0 1px 2px rgb(14 34 64 / 0.12)',
  overlay: '0 8px 24px rgb(14 34 64 / 0.16)',
} as const;

export const zIndex = { header: 10, drawer: 20, overlay: 30, popover: 35, toast: 40 } as const;

export const motion = {
  flash: '120ms',
  panel: '200ms',
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

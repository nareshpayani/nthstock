/**
 * nthstock design tokens: the single source for tokens.css (CSS variables) and the Tailwind theme.
 * One light theme only (CLAUDE.md D4). Approved by the owner on 2026-09-25.
 * Palette variant "closer" (2026-09-26): bright blue primary on white, deep navy ink.
 * nthstock's own values; deliberately far from any third-party brand colour.
 * Marigold is a fill colour only (focus rings, pills, highlights) and never used for text.
 * Tokens v2 (SPEC-CR-1 §4.1, "Instrument", 2026-10-28): darker ink, finer lines, a cooler canvas and
 * `marigold-ink` for the trailing-stop line; brand, up, down and marigold keep their values.
 */

export const colors = {
  brand: '#1463D8',
  'brand-soft': '#E8F1FD',
  marigold: '#F2B632',
  'marigold-soft': '#FDF3DC',
  /** The trailing-stop line's stroke: marigold deep enough for 3:1 on white. Never text. */
  'marigold-ink': '#A86B00',
  up: '#0B7A52',
  'up-soft': '#E3F3EC',
  down: '#C0392B',
  'down-soft': '#FBE9E7',
  ink: '#0B1526',
  'ink-muted': '#4A5568',
  canvas: '#F5F7FA',
  line: '#E4E8EE',
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

/**
 * Type scale in px, ratio about 1.2: 40 / 32 / 24 / 20 / 16 / 14 / 12. `price` is the instrument
 * price in tabular mono (SPEC-CR-1 §4.1); under 360 px wide it steps down to `display`.
 */
export const typeScale = {
  price: { size: 40, lineHeight: 44, weight: 500 },
  display: { size: 32, lineHeight: 40, weight: 600 },
  headline: { size: 24, lineHeight: 32, weight: 600 },
  title: { size: 20, lineHeight: 28, weight: 600 },
  lg: { size: 16, lineHeight: 24, weight: 500 },
  body: { size: 14, lineHeight: 20, weight: 400 },
  label: { size: 12, lineHeight: 16, weight: 500 },
} as const satisfies Record<string, TypeStep>;

/** Spacing steps in px. Tailwind's spacing unit is 4 px, so p-1 … p-12 map onto these. */
export const spacing = [4, 8, 12, 16, 24, 32, 48] as const;
export const spacingUnit = 4;

/** Radii: 4 px chips, 8 px cards, 12 px controls, 20 px sheet corners. */
export const radius = { sm: 4, md: 8, lg: 12, xl: 20, pill: 9999 } as const;

/** Cards use borders, not shadows. One shadow for menus and overlays, one hairline for raised chips. */
export const shadows = {
  raised: '0 1px 2px rgb(11 21 38 / 0.12)',
  /** A grabbed line tab lifts off the price rail. */
  lifted: '0 4px 12px rgb(11 21 38 / 0.22)',
  overlay: '0 8px 24px rgb(11 21 38 / 0.16)',
} as const;

export const zIndex = { header: 10, drawer: 20, overlay: 30, popover: 35, toast: 40 } as const;

/**
 * Motion (SPEC-CR-1 §4.1, §5). `flash` and `panel` are the original two durations; the round adds
 * fast / base / slow and an ease-in for exits. Every use is switched off or swapped for a short fade
 * under prefers-reduced-motion (§5.8).
 */
export const motion = {
  flash: '120ms',
  panel: '200ms',
  fast: '120ms',
  base: '180ms',
  slow: '280ms',
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

/**
 * The one spring for drags and sheets: critically damped (damping = 2·√(stiffness·mass)), so a
 * settling line or sheet never overshoots its target. Read by the web app's spring helper.
 */
export const spring = { stiffness: 520, damping: 2 * Math.sqrt(520), mass: 1 } as const;

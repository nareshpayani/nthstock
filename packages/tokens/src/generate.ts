import {
  colors,
  fonts,
  motion,
  radius,
  shadows,
  spacing,
  spacingUnit,
  typeScale,
  zIndex,
} from './tokens.js';

const HEADER = '/* Generated from packages/tokens/src/tokens.ts. Do not edit by hand. */\n';

function block(selector: string, lines: string[]): string {
  return `${selector} {\n${lines.map((line) => `  ${line}`).join('\n')}\n}\n`;
}

/** The CSS custom properties every surface reads (web app, Storybook, later a native bridge). */
export function toCssVariables(): string {
  const lines = ['color-scheme: light;'];
  for (const [name, value] of Object.entries(colors)) lines.push(`--nth-color-${name}: ${value};`);
  for (const [name, value] of Object.entries(fonts)) lines.push(`--nth-font-${name}: ${value};`);
  for (const [name, step] of Object.entries(typeScale)) {
    lines.push(`--nth-text-${name}: ${String(step.size)}px;`);
    lines.push(`--nth-text-${name}-line-height: ${String(step.lineHeight)}px;`);
    lines.push(`--nth-text-${name}-weight: ${String(step.weight)};`);
  }
  lines.push(`--nth-space-unit: ${String(spacingUnit)}px;`);
  for (const px of spacing) lines.push(`--nth-space-${String(px)}: ${String(px)}px;`);
  for (const [name, px] of Object.entries(radius))
    lines.push(`--nth-radius-${name}: ${String(px)}px;`);
  for (const [name, value] of Object.entries(shadows))
    lines.push(`--nth-shadow-${name}: ${value};`);
  for (const [name, value] of Object.entries(zIndex))
    lines.push(`--nth-z-${name}: ${String(value)};`);
  lines.push(`--nth-duration-flash: ${motion.flash};`);
  lines.push(`--nth-duration-panel: ${motion.panel};`);
  lines.push(`--nth-ease-standard: ${motion.easing};`);
  return HEADER + block(':root', lines);
}

/**
 * Tailwind CSS v4 theme ("preset"): maps utilities onto the variables above. `inline` makes each
 * utility emit `var(--nth-…)` directly, and the `initial` resets remove Tailwind's default palette,
 * fonts, sizes, radii and shadows, so only nthstock tokens exist as classes.
 */
export function toTailwindTheme(): string {
  const lines = ['--color-*: initial;'];
  for (const name of Object.keys(colors)) lines.push(`--color-${name}: var(--nth-color-${name});`);
  lines.push('--font-*: initial;');
  for (const name of Object.keys(fonts)) lines.push(`--font-${name}: var(--nth-font-${name});`);
  lines.push('--text-*: initial;');
  for (const name of Object.keys(typeScale)) {
    lines.push(`--text-${name}: var(--nth-text-${name});`);
    lines.push(`--text-${name}--line-height: var(--nth-text-${name}-line-height);`);
    lines.push(`--text-${name}--font-weight: var(--nth-text-${name}-weight);`);
  }
  lines.push('--spacing: var(--nth-space-unit);');
  lines.push('--radius-*: initial;');
  for (const name of Object.keys(radius))
    lines.push(`--radius-${name}: var(--nth-radius-${name});`);
  lines.push('--shadow-*: initial;');
  for (const name of Object.keys(shadows))
    lines.push(`--shadow-${name}: var(--nth-shadow-${name});`);
  lines.push('--ease-standard: var(--nth-ease-standard);');
  return HEADER + block('@theme inline', lines);
}

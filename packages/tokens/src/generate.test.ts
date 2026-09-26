import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { toCssVariables, toTailwindTheme } from './generate.js';

async function buildUtilities(candidates: string[]): Promise<string> {
  const compiler = await compile(`${toTailwindTheme()}\n@tailwind utilities;`, {
    loadStylesheet: () => Promise.reject(new Error('no imports expected')),
  });
  return compiler.build(candidates);
}

describe('toCssVariables', () => {
  const css = toCssVariables();

  it('emits one :root block with the approved palette', () => {
    expect(css).toContain(':root {');
    expect(css).toContain('color-scheme: light;');
    expect(css).toContain('--nth-color-brand: #1463D8;');
    expect(css).toContain('--nth-color-up: #0B7A52;');
    expect(css).toContain('--nth-color-down: #C0392B;');
    expect(css).toContain("--nth-font-sans: 'IBM Plex Sans'");
    expect(css).toContain('--nth-text-display: 32px;');
    expect(css).toContain('--nth-space-48: 48px;');
    expect(css).toContain('--nth-radius-lg: 12px;');
    expect(css).toContain('--nth-z-toast: 40;');
    expect(css).toContain('--nth-duration-flash: 120ms;');
  });

  it('has no dark theme', () => {
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).not.toContain('dark');
  });
});

describe('toTailwindTheme', () => {
  it('maps bg-surface and text-up to CSS variables', async () => {
    const out = await buildUtilities(['bg-surface', 'text-up', 'p-4', 'rounded-md', 'text-title']);
    expect(out).toMatch(/\.bg-surface\s*{\s*background-color: var\(--nth-color-surface\);/);
    expect(out).toMatch(/\.text-up\s*{\s*color: var\(--nth-color-up\);/);
    expect(out).toContain('var(--nth-radius-md)');
    expect(out).toContain('var(--nth-text-title)');
    expect(out).toContain('var(--nth-text-title-weight)');
    expect(out).toContain('calc(var(--nth-space-unit) * 4)');
  });

  it('removes the default Tailwind palette', async () => {
    const out = await buildUtilities(['bg-red-500', 'text-blue-600', 'shadow-lg']);
    expect(out).not.toContain('bg-red-500');
    expect(out).not.toContain('text-blue-600');
    expect(out).not.toContain('shadow-lg');
  });
});

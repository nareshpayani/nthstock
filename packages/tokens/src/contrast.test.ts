import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast.js';
import { colors, textColors } from './tokens.js';

describe('contrast', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
    expect(relativeLuminance('#ffffff')).toBe(1);
  });

  it('rejects anything but #RRGGBB', () => {
    expect(() => relativeLuminance('#fff')).toThrow(RangeError);
    expect(() => relativeLuminance('red')).toThrow(RangeError);
  });

  it.each(textColors)('%s text reaches 4.5:1 on surface and canvas (WCAG 2.2 AA)', (name) => {
    expect(contrastRatio(colors[name], colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors[name], colors.canvas)).toBeGreaterThanOrEqual(4.5);
  });

  it('white text reaches 4.5:1 on the brand, buy and sell fills', () => {
    for (const fill of [colors.brand, colors.up, colors.down]) {
      expect(contrastRatio(colors.surface, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ink reaches 4.5:1 on marigold and the soft tints', () => {
    for (const fill of ['marigold', 'marigold-soft', 'brand-soft'] as const) {
      expect(contrastRatio(colors.ink, colors[fill])).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(colors.up, colors['up-soft'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.down, colors['down-soft'])).toBeGreaterThanOrEqual(4.5);
  });
});

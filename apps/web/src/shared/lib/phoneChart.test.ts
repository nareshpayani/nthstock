import { describe, expect, it } from 'vitest';
import { landscapeChartHeight, phoneChartHeight } from './phoneChart';

describe('phone chart height (SPEC-CR-1 §6.1, §6.2)', () => {
  it('is 40% of a portrait phone, between 220 and 480 px', () => {
    expect(phoneChartHeight(844)).toBe(338);
    expect(phoneChartHeight(500)).toBe(220);
    expect(phoneChartHeight(1400)).toBe(480);
  });

  it('fills the height between the app bar and the dock in landscape, never under 160 px', () => {
    expect(landscapeChartHeight(390)).toBe(222);
    expect(landscapeChartHeight(430)).toBe(262);
    expect(landscapeChartHeight(300)).toBe(160);
  });
});

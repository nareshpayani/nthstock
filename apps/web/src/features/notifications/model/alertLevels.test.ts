import { describe, expect, it } from 'vitest';
import { conditionFor, presetLevel } from './alertLevels';

describe('alert levels (NSTOCK-0344)', () => {
  it('moves the LTP by a percent onto the tick, away from it', () => {
    expect(presetLevel(152_000, 1)).toBe(153_520);
    expect(presetLevel(152_000, -2)).toBe(148_960);
    expect(presetLevel(152_003, 1) % 5).toBe(0);
    expect(presetLevel(152_003, 1)).toBeGreaterThan(152_003 * 1.01 - 5);
    expect(presetLevel(4, -2)).toBe(5);
  });

  it('reads the condition from which side of the LTP the price is', () => {
    expect(conditionFor(153_000, 152_000)).toBe('ABOVE');
    expect(conditionFor(151_000, 152_000)).toBe('BELOW');
    expect(conditionFor(152_000, 152_000)).toBeNull();
  });
});

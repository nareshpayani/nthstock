import { describe, expect, it } from 'vitest';
import { spring, typeScale } from './tokens.js';

describe('tokens', () => {
  it('the spring is critically damped, so drags and sheets never overshoot', () => {
    expect(spring.damping).toBeCloseTo(2 * Math.sqrt(spring.stiffness * spring.mass), 10);
  });

  it('the type scale steps up by about 1.2 and every line height is on the 4 px grid', () => {
    expect(Object.values(typeScale).map((step) => step.size)).toEqual([40, 32, 24, 20, 16, 14, 12]);
    for (const step of Object.values(typeScale)) expect(step.lineHeight % 4).toBe(0);
  });
});

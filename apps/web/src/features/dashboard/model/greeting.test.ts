import { fromIst } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { greetingFor } from './greeting';

describe('greetingFor', () => {
  it('uses IST hours', () => {
    expect(greetingFor(fromIst(2026, 9, 25, 9 * 60))).toBe('Good morning');
    expect(greetingFor(fromIst(2026, 9, 25, 13 * 60))).toBe('Good afternoon');
    expect(greetingFor(fromIst(2026, 9, 25, 20 * 60))).toBe('Good evening');
  });
});

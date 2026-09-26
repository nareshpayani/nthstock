import { fromIst } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { firstName, greetingFor, heroGreeting } from './greeting';

const ist = (hour: number, minute = 0) => fromIst(2026, 9, 25, hour * 60 + minute);

describe('greetingFor (IST)', () => {
  it('08:00, 13:00 and 19:00 IST are morning, afternoon and evening (T-093)', () => {
    expect(greetingFor(ist(8))).toBe('Good morning');
    expect(greetingFor(ist(13))).toBe('Good afternoon');
    expect(greetingFor(ist(19))).toBe('Good evening');
  });

  it('switches at 12:00 and 17:00 IST', () => {
    expect(greetingFor(ist(11, 59))).toBe('Good morning');
    expect(greetingFor(ist(12))).toBe('Good afternoon');
    expect(greetingFor(ist(16, 59))).toBe('Good afternoon');
    expect(greetingFor(ist(17))).toBe('Good evening');
    expect(greetingFor(ist(0))).toBe('Good morning');
  });

  it('uses IST, not the UTC hour', () => {
    // 08:00 IST is 02:30 UTC; 19:00 IST is 13:30 UTC.
    expect(ist(8).toISOString()).toBe('2026-09-25T02:30:00.000Z');
    expect(greetingFor(new Date('2026-09-25T13:30:00.000Z'))).toBe('Good evening');
  });
});

describe('heroGreeting', () => {
  it('adds the first name when the user has one', () => {
    expect(heroGreeting(ist(8), 'Asha Rao')).toBe('Good morning, Asha');
    expect(heroGreeting(ist(19), '  Ravi  ')).toBe('Good evening, Ravi');
  });

  it('is the bare greeting without a name', () => {
    expect(heroGreeting(ist(13), null)).toBe('Good afternoon');
    expect(heroGreeting(ist(13), undefined)).toBe('Good afternoon');
    expect(firstName('   ')).toBeNull();
  });
});

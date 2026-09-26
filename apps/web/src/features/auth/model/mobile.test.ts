import { describe, expect, it } from 'vitest';
import { formatMobile, normalizeMobile } from './mobile';

describe('normalizeMobile', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['98765 43210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['12345', '12345'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });
});

describe('formatMobile', () => {
  it('groups 5 + 5', () => {
    expect(formatMobile('9876543210')).toBe('98765 43210');
    expect(formatMobile('123')).toBe('123');
  });
});

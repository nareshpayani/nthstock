import { describe, expect, it } from 'vitest';
import { cn } from './cn.js';

describe('cn', () => {
  it('keeps a token size and a token colour together', () => {
    expect(cn('text-body', 'text-ink')).toBe('text-body text-ink');
  });

  it('lets the last conflicting class win and drops falsy values', () => {
    expect(cn('bg-surface p-2', false, undefined, 'bg-canvas', null)).toBe('p-2 bg-canvas');
    expect(cn('text-ink', 'text-up')).toBe('text-up');
    expect(cn('rounded-md', 'rounded-lg')).toBe('rounded-lg');
  });
});

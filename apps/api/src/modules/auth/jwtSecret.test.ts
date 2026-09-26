import { describe, expect, it, vi } from 'vitest';
import { MIN_JWT_SECRET_LENGTH, resolveJwtSecret } from './jwtSecret.js';

const LONG = 'x'.repeat(MIN_JWT_SECRET_LENGTH);

describe('resolveJwtSecret', () => {
  it('uses the configured secret', () => {
    expect(resolveJwtSecret({ value: ` ${LONG} `, production: true })).toEqual(
      new TextEncoder().encode(LONG),
    );
  });

  it('fails fast in production without a secret', () => {
    for (const value of [undefined, '', '   ']) {
      expect(() => resolveJwtSecret({ value, production: true })).toThrow(
        /must be set in production/,
      );
    }
  });

  it('generates a random ephemeral key outside production and says so', () => {
    const onEphemeral = vi.fn();
    const a = resolveJwtSecret({ value: undefined, production: false, onEphemeral });
    const b = resolveJwtSecret({ value: '', production: false });

    expect(a).toHaveLength(MIN_JWT_SECRET_LENGTH);
    expect(a).not.toEqual(b);
    expect(onEphemeral).toHaveBeenCalledOnce();
  });

  it('rejects a short secret', () => {
    expect(() => resolveJwtSecret({ value: 'short', production: false })).toThrow(/at least 32/);
  });
});

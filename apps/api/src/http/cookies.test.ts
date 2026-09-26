import { describe, expect, it } from 'vitest';
import { parseCookies, serializeCookie } from './cookies.js';

describe('parseCookies', () => {
  it('reads name=value pairs, keeping the first of duplicates', () => {
    expect(parseCookies('a=1; b=x.y-z_; a=2')).toEqual({ a: '1', b: 'x.y-z_' });
  });

  it('skips malformed pairs and handles a missing header', () => {
    expect(parseCookies('novalue; bad name=1; ok=2; v=a"b')).toEqual({ ok: '2' });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });
});

describe('serializeCookie', () => {
  const options = {
    maxAge: 900,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Strict',
  } as const;

  it('writes the attributes the auth cookies need', () => {
    expect(serializeCookie('nth_at', 'abc', options)).toBe(
      'nth_at=abc; Max-Age=900; Path=/; SameSite=Strict; HttpOnly',
    );
    expect(
      serializeCookie('x', '', { ...options, maxAge: -5, httpOnly: false, secure: true }),
    ).toBe('x=; Max-Age=0; Path=/; SameSite=Strict; Secure');
  });

  it('refuses names and values that would break the header', () => {
    expect(() => serializeCookie('a b', '1', options)).toThrow(/name/);
    expect(() => serializeCookie('a', '1;Path=/x', options)).toThrow(/value/);
  });
});

import { describe, expect, it } from 'vitest';
import { createCookieJar } from './cookieJar.js';

describe('scenario cookie jar', () => {
  it('stores Set-Cookie lines and sends them back', () => {
    const jar = createCookieJar();
    expect(jar.header()).toBeNull();

    jar.store(['a=1; Path=/; HttpOnly', 'b=x.y; Max-Age=900; Path=/v1/auth', 'junk', '=nameless']);

    expect(jar.get('a')).toBe('1');
    expect(jar.header()).toBe('a=1; b=x.y');
  });

  it('turns deleted cookies into tombstones sent as empty values', () => {
    const jar = createCookieJar();
    jar.store(['a=1', 'b=2']);
    jar.store(['a=; Max-Age=0; Path=/']);
    jar.delete('b');

    expect(jar.get('a')).toBeUndefined();
    expect(jar.header()).toBe('a=; b=');
    expect(jar.snapshot()).toEqual({});
  });

  it('restores a snapshot, tombstoning cookies set since', () => {
    const jar = createCookieJar();
    jar.set('a', 'old');
    const before = jar.snapshot();
    jar.store(['a=new', 'c=3']);

    jar.restore(before);

    expect(jar.header()).toBe('a=old; c=');
    expect(jar.snapshot()).toEqual({ a: 'old' });
  });
});

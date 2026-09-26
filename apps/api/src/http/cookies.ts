/**
 * Minimal cookie parsing and serialising, so apps/api needs no cookie plugin. Only what the auth
 * cookies use: names are fixed tokens and values are base64url or JWT characters.
 */

export type CookieOptions = {
  /** Seconds; 0 deletes the cookie. */
  maxAge: number;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax';
};

const NAME = /^[A-Za-z0-9_-]+$/;
const VALUE = /^[A-Za-z0-9._~+/=-]*$/;

/** `a=1; b=2` → `{ a: '1', b: '2' }`. The first value wins; malformed pairs are skipped. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!NAME.test(name) || !VALUE.test(value) || name in cookies) continue;
    cookies[name] = value;
  }
  return cookies;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  if (!NAME.test(name)) throw new Error(`Invalid cookie name "${name}"`);
  if (!VALUE.test(value)) throw new Error(`Invalid value for cookie "${name}"`);
  const parts = [
    `${name}=${value}`,
    `Max-Age=${String(Math.max(0, Math.floor(options.maxAge)))}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`,
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

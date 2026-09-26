/**
 * A tiny cookie jar for scenario clients: one per scenario, like one browser profile. It sends
 * every cookie it holds on every request (paths and expiry are the server's business here).
 *
 * A cookie the server deletes, or the scenario forgets, becomes a tombstone that is sent as an
 * empty value (`name=`). That overrides a copy a backend may keep elsewhere (MSW's own cookie
 * store), and both backends treat an empty cookie as absent.
 */
export type CookieSnapshot = Readonly<Record<string, string>>;

export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): void;
  /** Applies `Set-Cookie` lines from a response. */
  store(setCookies: readonly string[]): void;
  /** The Cookie header to send, or null when there is nothing to send. */
  header(): string | null;
  snapshot(): CookieSnapshot;
  /** Puts the jar back to `snapshot`; cookies set since then become tombstones. */
  restore(snapshot: CookieSnapshot): void;
}

const EXPIRED = /;\s*max-age=0\s*(;|$)/i;

export function createCookieJar(): CookieJar {
  const cookies = new Map<string, string>();

  const jar: CookieJar = {
    get: (name) => {
      const value = cookies.get(name);
      return value === '' ? undefined : value;
    },
    set: (name, value) => {
      cookies.set(name, value);
    },
    delete: (name) => {
      cookies.set(name, '');
    },
    store(setCookies) {
      for (const line of setCookies) {
        const [pair = ''] = line.split(';');
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        cookies.set(name, EXPIRED.test(line) ? '' : value);
      }
    },
    header() {
      if (cookies.size === 0) return null;
      return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    snapshot: () => Object.fromEntries([...cookies].filter(([, value]) => value !== '')),
    restore(snapshot) {
      for (const name of cookies.keys()) cookies.set(name, '');
      for (const [name, value] of Object.entries(snapshot)) cookies.set(name, value);
    },
  };
  return jar;
}

/** Where a successful login goes when there is no (usable) redirect. */
export const DEFAULT_AFTER_LOGIN = '/dashboard';

/**
 * The `?redirect=` target, only if it is a path inside this app: it must start with a single "/"
 * (no `//host` or `/\host`, which browsers treat as another origin) and must not point back at
 * /login. Anything else falls back to the dashboard, so the param can never become an open redirect.
 */
export function safeRedirect(target: unknown): string {
  if (typeof target !== 'string' || !target.startsWith('/')) return DEFAULT_AFTER_LOGIN;
  if (target.startsWith('//') || target.startsWith('/\\')) return DEFAULT_AFTER_LOGIN;
  if (target === '/login' || target.startsWith('/login?') || target.startsWith('/login/')) {
    return DEFAULT_AFTER_LOGIN;
  }
  return target;
}

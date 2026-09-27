// Loaded by vite.config.ts under Node, so it imports nothing from the app.

/**
 * Security headers for the server that serves the built SPA (T-173, CLAUDE.md security baseline):
 * `vite preview` locally and in E2E, and the same list for the per-PR preview and the CDN later.
 * The dev server (`vite`) does not send them: its HMR client injects inline scripts a strict CSP
 * would block.
 *
 * The CSP allows only this origin, plus the API and WebSocket origins when the build points
 * elsewhere (`VITE_API_BASE_URL`, `VITE_WS_URL`). No inline or eval'd script: Vite emits module
 * files. Styles come from files, and React sets `style` through the CSSOM, which CSP does not block.
 */

/** Two years, with subdomains: the HSTS preload list minimum (the same value as apps/api). */
export const WEB_HSTS_VALUE = 'max-age=63072000; includeSubDomains; preload';

export type WebSecurityHeadersOptions = {
  /** `VITE_API_BASE_URL`; '' means same origin. */
  apiBaseUrl?: string;
  /** `VITE_WS_URL`; null or '' means `/ws` on the page's own origin. */
  wsUrl?: string | null;
  /**
   * Send `Strict-Transport-Security`: only outside local, where the site is served over HTTPS
   * (`SECURITY_HSTS=true`). Never on 127.0.0.1, where HSTS would pin localhost to HTTPS.
   */
  hsts?: boolean;
};

const originOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** The Content-Security-Policy value for the SPA. */
export function webContentSecurityPolicy({
  apiBaseUrl,
  wsUrl,
}: Pick<WebSecurityHeadersOptions, 'apiBaseUrl' | 'wsUrl'> = {}): string {
  const connect = ["'self'", originOf(apiBaseUrl), originOf(wsUrl)].filter(
    (source): source is string => source !== null,
  );
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${[...new Set(connect)].join(' ')}`,
    // The MSW service worker (msw mode) is a file on this origin.
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Every header, by lower-case name. */
export function webSecurityHeaders(
  options: WebSecurityHeadersOptions = {},
): Record<string, string> {
  return {
    'content-security-policy': webContentSecurityPolicy(options),
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    ...(options.hsts ? { 'strict-transport-security': WEB_HSTS_VALUE } : {}),
  };
}

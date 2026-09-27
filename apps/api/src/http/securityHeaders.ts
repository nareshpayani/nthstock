import type { FastifyInstance } from 'fastify';

/**
 * Security headers on every apps/api response (T-173, CLAUDE.md security baseline). The API only
 * answers JSON, so its CSP allows nothing to load or frame it; the web app's own CSP is set by the
 * server that serves the SPA (`apps/web/src/app/securityHeaders.ts`).
 */
export const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** Two years, with subdomains: the HSTS preload list minimum. */
export const HSTS_VALUE = 'max-age=63072000; includeSubDomains; preload';

export type SecurityHeadersOptions = {
  /**
   * Send `Strict-Transport-Security`: on outside local development (production, behind TLS at the
   * load balancer); off locally, where apps/api is plain HTTP and HSTS would pin localhost.
   */
  hsts: boolean;
};

/** The headers, by name; exported so tests and the web preview server agree on the shared ones. */
export function apiSecurityHeaders({ hsts }: SecurityHeadersOptions): Record<string, string> {
  return {
    'content-security-policy': API_CONTENT_SECURITY_POLICY,
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    ...(hsts ? { 'strict-transport-security': HSTS_VALUE } : {}),
  };
}

/** Adds the headers to every reply, errors and 404s included. */
export function installSecurityHeaders(
  app: FastifyInstance,
  options: SecurityHeadersOptions,
): void {
  const headers = apiSecurityHeaders(options);
  app.addHook('onRequest', async (_request, reply) => {
    reply.headers(headers);
  });
}

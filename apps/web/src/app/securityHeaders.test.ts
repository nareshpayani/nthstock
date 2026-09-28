import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHART_ATTRIBUTION_STYLE_HASH,
  WEB_HSTS_VALUE,
  webContentSecurityPolicy,
  webSecurityHeaders,
} from './securityHeaders';

describe('webSecurityHeaders (T-173)', () => {
  it('sends a same-origin CSP, X-Frame-Options DENY and nosniff, without HSTS by default', () => {
    const headers = webSecurityHeaders();
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers).not.toHaveProperty('strict-transport-security');
    const csp = headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
  });

  it('adds HSTS only when asked (served over HTTPS)', () => {
    expect(webSecurityHeaders({ hsts: true })['strict-transport-security']).toBe(WEB_HSTS_VALUE);
  });

  it('lets the page reach a configured API and WebSocket origin, once each', () => {
    expect(
      webContentSecurityPolicy({
        apiBaseUrl: 'https://api.example.com',
        wsUrl: 'wss://live.example.com/ws',
      }),
    ).toContain("connect-src 'self' https://api.example.com wss://live.example.com;");
    expect(
      webContentSecurityPolicy({
        apiBaseUrl: 'https://x.example.com',
        wsUrl: 'wss://x.example.com/ws',
      }),
    ).toContain("connect-src 'self' https://x.example.com wss://x.example.com;");
  });

  it('ignores a value that is not a URL', () => {
    expect(webContentSecurityPolicy({ apiBaseUrl: 'not a url', wsUrl: '' })).toContain(
      "connect-src 'self';",
    );
  });
});

/** The production build Vite bundles (the package's exports hide the file from resolve). */
const LIBRARY_BUILD = 'lightweight-charts/dist/lightweight-charts.production.mjs';

/** Looks for a file in node_modules from the working directory up, as Node's lookup does. */
function findInNodeModules(file: string): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', file);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error(`${file} not found in any node_modules`);
  }
}

describe('chart attribution style hash', () => {
  it('matches the inline style the installed Lightweight Charts adds, and is the only inline style allowed', () => {
    const library = readFileSync(findInNodeModules(LIBRARY_BUILD), 'utf8');
    const style = /createElement\("style"\),this\.\w+\.innerText="([^"]*)"/.exec(library)?.[1];
    expect(style).toBeDefined();
    const hash = createHash('sha256')
      .update(style ?? '')
      .digest('base64');
    expect(CHART_ATTRIBUTION_STYLE_HASH).toBe(`'sha256-${hash}'`);
    expect(webContentSecurityPolicy()).toContain(
      `style-src 'self' ${CHART_ATTRIBUTION_STYLE_HASH};`,
    );
    expect(webContentSecurityPolicy()).not.toContain('unsafe-inline');
  });
});

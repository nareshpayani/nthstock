import { describe, expect, it } from 'vitest';
import { WEB_HSTS_VALUE, webContentSecurityPolicy, webSecurityHeaders } from './securityHeaders';

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

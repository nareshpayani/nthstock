// Loaded by vite.config.ts under Node, so the import names its extension.
import { WS_PATH, type ApiMode } from './runtimeConfig.ts';

/** Where `npm run dev:api` runs apps/api and apps/realtime (their default ports). */
export const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:4000';
export const DEFAULT_REALTIME_PROXY_TARGET = 'ws://127.0.0.1:8081';

/** The subset of Vite's proxy options used here (kept local so app code never imports Vite). */
export type DevProxyEntry = {
  target: string;
  changeOrigin: boolean;
  ws?: boolean;
  cookieDomainRewrite?: Record<string, string>;
};

/** Dev/preview-server settings, not shipped to the browser, so not `VITE_*`. */
export type DevProxyEnv = {
  API_PROXY_TARGET?: string | undefined;
  REALTIME_PROXY_TARGET?: string | undefined;
};

/**
 * Vite dev and preview proxy for api mode (T-076). The browser only ever talks to the page's own
 * origin: REST `/v1` goes to apps/api and the `/ws` WebSocket to apps/realtime. Keeping the Host
 * header (`changeOrigin: false`) and stripping any cookie Domain makes session cookies same-origin
 * first-party cookies, which SameSite=Strict needs. In msw mode there is no proxy: MSW answers in
 * the browser, and an unhandled request should fail rather than reach a server.
 */
export function devProxy(
  apiMode: ApiMode,
  env: DevProxyEnv = {},
): Record<string, DevProxyEntry> | undefined {
  if (apiMode !== 'api') return undefined;
  return {
    '/v1': {
      target: env.API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET,
      changeOrigin: false,
      cookieDomainRewrite: { '*': '' },
    },
    [WS_PATH]: {
      target: env.REALTIME_PROXY_TARGET || DEFAULT_REALTIME_PROXY_TARGET,
      changeOrigin: false,
      ws: true,
    },
  };
}

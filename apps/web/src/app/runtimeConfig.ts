import { z } from 'zod';

/**
 * Web runtime configuration (T-049, ADR 0004). Everything comes from `VITE_*` variables, which Vite
 * inlines at build time, so nothing here is secret: every value ends up in the shipped JS.
 * `.env.example` lists each variable; `runtimeConfig.test.ts` keeps the two in step.
 */

export const API_MODES = ['msw', 'api'] as const;
export type ApiMode = (typeof API_MODES)[number];

/** Path of the realtime WebSocket endpoint on its host. */
export const WS_PATH = '/ws';

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

const httpUrl = z
  .url({ protocol: /^https?$/, error: 'must be an http(s) URL such as https://api.example.com' })
  .refine((url) => !url.endsWith('/v1') && !url.endsWith('/v1/'), {
    error: 'must not end in /v1: route paths already start with /v1',
  });

const wsUrl = z.url({
  protocol: /^wss?$/,
  error: 'must be a ws(s) URL such as wss://example.com/ws',
});

const flag = z
  .enum(['true', 'false', '1', '0'], { error: 'must be true or false' })
  .transform((value) => value === 'true' || value === '1');

/** The variables, their meaning and defaults. Keys are exactly the names in `.env.example`. */
export const runtimeEnvSchema = z.object({
  /** `msw` mocks REST and WebSocket in the browser (default); `api` talks to apps/api and apps/realtime. */
  VITE_API_MODE: optional(
    z.enum(API_MODES, { error: `must be one of: ${API_MODES.join(', ')}` }),
  ).transform((value) => value ?? 'msw'),
  /** Origin of the REST API. Empty means the page's own origin (the Vite proxy in api mode). */
  VITE_API_BASE_URL: optional(httpUrl).transform((value) => (value ?? '').replace(/\/+$/, '')),
  /** Realtime WebSocket URL. Empty means `ws(s)://<page host>/ws`. */
  VITE_WS_URL: optional(wsUrl).transform((value) => value ?? null),
  /** msw mode only: tick the mock market even outside NSE hours, for demos and e2e. */
  VITE_MOCK_MARKET_OPEN: optional(flag).transform((value) => value ?? false),
});

export type RuntimeConfig = {
  apiMode: ApiMode;
  /** Prefix for REST paths ('' = same origin). */
  apiBaseUrl: string;
  /** Explicit WebSocket URL, or null to derive it from the page location. */
  wsUrl: string | null;
  mockMarketOpen: boolean;
};

export class RuntimeConfigError extends Error {
  override readonly name = 'RuntimeConfigError';
}

/**
 * Validates the environment and fails fast: an unknown mode or a malformed URL throws at start-up
 * (and when `vite` or `vite build` loads its config) instead of surfacing later as odd behaviour.
 */
export function parseRuntimeConfig(env: Readonly<Record<string, unknown>>): RuntimeConfig {
  const parsed = runtimeEnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ');
    throw new RuntimeConfigError(`Invalid web runtime config: ${problems}`);
  }
  const data = parsed.data;
  return {
    apiMode: data.VITE_API_MODE,
    apiBaseUrl: data.VITE_API_BASE_URL,
    wsUrl: data.VITE_WS_URL,
    mockMarketOpen: data.VITE_MOCK_MARKET_OPEN,
  };
}

/** The WebSocket URL to use: the configured one, or `/ws` on the page's own host. */
export function resolveWsUrl(
  config: Pick<RuntimeConfig, 'wsUrl'>,
  location: { protocol: string; host: string },
): string {
  if (config.wsUrl) return config.wsUrl;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}${WS_PATH}`;
}

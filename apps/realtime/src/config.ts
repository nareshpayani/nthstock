import { z } from 'zod';

/** The Redis `npm run infra:up` starts (infra/docker-compose.yml). */
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8081),
  HOST: z.string().min(1).default('0.0.0.0'),
  REDIS_URL: z
    .url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' })
    .default(DEFAULT_REDIS_URL),
});

export type RealtimeConfig = {
  port: number;
  host: string;
  /** Redis carrying ticks from apps/api (ADR 0004 §4). */
  redisUrl: string;
};

/** Reads and validates the environment; throws at startup on a bad value. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): RealtimeConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid apps/realtime environment: ${z.prettifyError(parsed.error)}`);
  }
  return { port: parsed.data.PORT, host: parsed.data.HOST, redisUrl: parsed.data.REDIS_URL };
}

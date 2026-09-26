import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8081),
  HOST: z.string().min(1).default('0.0.0.0'),
});

export type RealtimeConfig = {
  port: number;
  host: string;
};

/** Reads and validates the environment; throws at startup on a bad value. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): RealtimeConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid apps/realtime environment: ${z.prettifyError(parsed.error)}`);
  }
  return { port: parsed.data.PORT, host: parsed.data.HOST };
}

import { z } from 'zod';

const Flag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => value === 'true' || value === '1');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  MOCK_MARKET_ALWAYS_OPEN: Flag,
});

export type ApiConfig = {
  port: number;
  host: string;
  /** Tick the mock market outside NSE hours (documented in `.env.example`). */
  mockMarketAlwaysOpen: boolean;
};

/** Reads and validates the environment; throws at startup on a bad value. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid apps/api environment: ${z.prettifyError(parsed.error)}`);
  }
  return {
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    mockMarketAlwaysOpen: parsed.data.MOCK_MARKET_ALWAYS_OPEN,
  };
}

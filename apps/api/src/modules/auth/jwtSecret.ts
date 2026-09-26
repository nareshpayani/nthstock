import { randomBytes } from 'node:crypto';

/** Shortest JWT_SECRET accepted: 32 bytes, the HS256 key size. */
export const MIN_JWT_SECRET_LENGTH = 32;

export type JwtSecretOptions = {
  /** `JWT_SECRET` from the environment; blank counts as unset. */
  value: string | undefined;
  production: boolean;
  /** Told when an ephemeral dev key is generated (never given the key). */
  onEphemeral?: () => void;
};

/**
 * The HS256 key for access tokens. It always comes from the environment in production (startup
 * fails without it). Elsewhere an unset value gets a random key for this process only, so sessions
 * end on restart; `npm run dev:api` generates one key and passes it to apps/api and apps/realtime.
 */
export function resolveJwtSecret({ value, production, onEphemeral }: JwtSecretOptions): Uint8Array {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    if (production) throw new Error('JWT_SECRET must be set in production');
    onEphemeral?.();
    return new Uint8Array(randomBytes(MIN_JWT_SECRET_LENGTH));
  }
  if (trimmed.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${String(MIN_JWT_SECRET_LENGTH)} characters`);
  }
  return new TextEncoder().encode(trimmed);
}

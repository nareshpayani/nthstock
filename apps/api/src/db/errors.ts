/** The Postgres error behind `error`: pg's own, or the one Drizzle wraps as `cause`. */
function postgresErrorOf(error: unknown): { code?: unknown; constraint?: unknown } | null {
  for (let current = error, depth = 0; current && depth < 3; depth += 1) {
    if (typeof current !== 'object') return null;
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code))
      return candidate;
    current = candidate.cause;
  }
  return null;
}

/** True for a unique violation (23505), optionally of one named constraint or index. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pgError = postgresErrorOf(error);
  if (pgError?.code !== '23505') return false;
  return constraint === undefined || pgError.constraint === constraint;
}

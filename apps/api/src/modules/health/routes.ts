import type { DependencyStatus } from '@nthstock/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { ApiHttpError } from '../../http/apiError.js';
import { registerRoute } from '../../http/registerRoute.js';

/** Version string the health route reports; bumped with releases. */
export const API_VERSION = '0.0.0';

/** Resolves when the dependency answers; rejects (or never settles) when it does not. */
export type ReadinessCheck = () => Promise<unknown>;

/** One check per backing service; null when this process is not configured to use it. */
export type ReadinessChecks = {
  postgres: ReadinessCheck | null;
  redis: ReadinessCheck | null;
};

/** A check that has not answered by then counts as down. */
export const READY_CHECK_TIMEOUT_MS = 2_000;

async function probe(
  check: ReadinessCheck | null,
  timeoutMs: number,
): Promise<{ status: DependencyStatus; error?: unknown }> {
  if (!check) return { status: 'disabled' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([check(), timeout]);
    return { status: 'up' };
  } catch (error) {
    return { status: 'down', error };
  } finally {
    clearTimeout(timer);
  }
}

export type HealthRouteDeps = Pick<AppDeps, 'clock'> & {
  readiness?: ReadinessChecks;
  readyTimeoutMs?: number;
};

/**
 * `GET /v1/health`: the process is up (liveness). `GET /v1/health/ready` (T-182): every configured
 * backing service answers, so the load balancer may send traffic; 503 SERVICE_UNAVAILABLE with
 * each service's status in `details` otherwise.
 */
export const healthRoutes =
  ({
    clock,
    readiness = { postgres: null, redis: null },
    readyTimeoutMs = READY_CHECK_TIMEOUT_MS,
  }: HealthRouteDeps): FastifyPluginAsync =>
  async (app) => {
    registerRoute(app, 'health', () => ({
      status: 'ok',
      version: API_VERSION,
      time: clock.now().toISOString(),
    }));

    registerRoute(app, 'healthReady', async ({ request }) => {
      const [postgres, redis] = await Promise.all([
        probe(readiness.postgres, readyTimeoutMs),
        probe(readiness.redis, readyTimeoutMs),
      ]);
      if (postgres.status === 'down' || redis.status === 'down') {
        request.log.warn(
          { postgres: postgres.error, redis: redis.error },
          'readiness check failed',
        );
        throw new ApiHttpError(503, 'SERVICE_UNAVAILABLE', 'A backing service is unavailable', {
          postgres: postgres.status,
          redis: redis.status,
        });
      }
      return { postgres: postgres.status, redis: redis.status };
    });
  };

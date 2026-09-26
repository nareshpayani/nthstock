import type { StartedTestContainer } from 'testcontainers';
import { describe } from 'vitest';

/**
 * Real Redis for integration tests (T-071).
 *
 * - Default (CI on ubuntu-latest, any machine with Docker): starts `redis:7-alpine` with
 *   Testcontainers and stops it afterwards.
 * - `REDIS_TEST_URL=redis://127.0.0.1:6379`: uses that server instead (for example
 *   `npm run infra:up`, or a local redis-server when Docker is unavailable).
 * - `SKIP_REDIS_INTEGRATION=1`: the only way to skip these suites, for a machine with neither. It is
 *   explicit, printed, and shows up as skipped tests in the Vitest summary. CI never sets it.
 */
export type TestRedis = { url: string; stop(): Promise<void> };

export const REDIS_TEST_IMAGE = 'redis:7-alpine';

const skip = process.env.SKIP_REDIS_INTEGRATION === '1';

/** `describe` for suites that need Redis; skipped (loudly) only under SKIP_REDIS_INTEGRATION=1. */
export function describeWithRedis(name: string, body: () => void) {
  if (skip) {
    process.stderr.write(
      `\n[redis] SKIP_REDIS_INTEGRATION=1: skipping "${name}". CI runs it with Testcontainers.\n`,
    );
    describe.skip(name, body);
    return;
  }
  describe(name, body);
}

export async function startTestRedis(): Promise<TestRedis> {
  const external = process.env.REDIS_TEST_URL;
  if (external) return { url: external, stop: () => Promise.resolve() };
  const { GenericContainer, Wait } = await import('testcontainers');
  let container: StartedTestContainer;
  try {
    container = await new GenericContainer(REDIS_TEST_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();
  } catch (error) {
    throw new Error(
      'Redis integration tests need Docker (Testcontainers). Start Docker, or set ' +
        'REDIS_TEST_URL to a running Redis, or set SKIP_REDIS_INTEGRATION=1 to skip them.',
      { cause: error },
    );
  }
  return {
    url: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
    async stop() {
      await container.stop();
    },
  };
}

/** A channel name no other test run uses, so suites can share one Redis. */
export const uniqueChannel = (prefix: string) =>
  `${prefix}:${process.pid}:${Math.random().toString(36).slice(2)}`;

import { describe, expect, it, vi } from 'vitest';
import { HANDSHAKE_TIMEOUT_MS, createWorkerKeeper } from './workerKeeper';

/** A fake service worker container whose worker answers MOCK_ACTIVATE when `replies` is on. */
function fakeEnv({ replies = true, controller = true } = {}) {
  const listeners = new Set<(event: Event) => void>();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const posted: unknown[] = [];
  const env = {
    serviceWorker: {
      controller: controller
        ? {
            postMessage: (message: unknown) => {
              posted.push(message);
              if (replies) {
                queueMicrotask(() => {
                  for (const listener of [...listeners]) {
                    listener(new MessageEvent('message', { data: { type: 'MOCKING_ENABLED' } }));
                  }
                });
              }
            },
          }
        : null,
      addEventListener: (_type: string, listener: (event: Event) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: Event) => void) => {
        listeners.delete(listener);
      },
    },
    setTimeout: (callback: () => void) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (handle: unknown) => {
      timers.delete(handle as number);
    },
  };
  return {
    // The fake covers what the keeper uses; the full ServiceWorkerContainer type is not needed.
    env: env as unknown as Parameters<typeof createWorkerKeeper>[0],
    posted,
    listeners,
    fireTimers: () => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
  };
}

describe('createWorkerKeeper (msw worker restarts)', () => {
  it('re-sends MOCK_ACTIVATE and resolves when the worker confirms', async () => {
    const fake = fakeEnv();
    const keeper = createWorkerKeeper(fake.env);
    await keeper.ensureActive();
    expect(fake.posted).toEqual(['MOCK_ACTIVATE']);
    expect(fake.listeners.size).toBe(0);
  });

  it('checks again on the next request, since the worker can stop at any time', async () => {
    const fake = fakeEnv();
    const keeper = createWorkerKeeper(fake.env);
    await keeper.ensureActive();
    await keeper.ensureActive();
    expect(fake.posted).toEqual(['MOCK_ACTIVATE', 'MOCK_ACTIVATE']);
  });

  it('shares one handshake between requests made together', async () => {
    const fake = fakeEnv();
    const keeper = createWorkerKeeper(fake.env);
    await Promise.all([keeper.ensureActive(), keeper.ensureActive(), keeper.ensureActive()]);
    expect(fake.posted).toHaveLength(1);
  });

  it('lets the request go ahead after a timeout when the worker does not answer', async () => {
    const fake = fakeEnv({ replies: false });
    const keeper = createWorkerKeeper(fake.env);
    const settled = vi.fn();
    const pending = keeper.ensureActive().then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    fake.fireTimers();
    await pending;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(fake.listeners.size).toBe(0);
    expect(HANDSHAKE_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('resolves at once when no worker controls the page', async () => {
    const fake = fakeEnv({ controller: false });
    const keeper = createWorkerKeeper(fake.env);
    await keeper.ensureActive();
    expect(fake.posted).toEqual([]);
  });
});

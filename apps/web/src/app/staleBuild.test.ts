import { describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForNewBuild, type StaleBuildEnv } from './staleBuild';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

function env(
  now: { value: number },
  storage = memoryStorage(),
): StaleBuildEnv & { reload: ReturnType<typeof vi.fn<() => void>> } {
  return {
    reload: vi.fn<() => void>(),
    online: () => true,
    whenOnline: vi.fn(),
    storage,
    now: () => now.value,
  };
}

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://nthstock-a13a5.web.app/assets/dashboard-ul55Qa07.js',
    'error loading dynamically imported module: https://example.test/assets/a.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/index.css',
  ])('recognises "%s"', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('ignores other errors and non-errors', () => {
    expect(isChunkLoadError(new Error('Request failed with 500'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('reloadForNewBuild', () => {
  it('reloads once, then not again within a minute, then again after it', () => {
    const now = { value: 1_000_000 };
    const e = env(now);
    expect(reloadForNewBuild(e)).toBe(true);
    now.value += 30_000;
    expect(reloadForNewBuild(e)).toBe(false);
    now.value += 31_000;
    expect(reloadForNewBuild(e)).toBe(true);
    expect(e.reload).toHaveBeenCalledTimes(2);
  });

  it('waits for the network when offline, then reloads', () => {
    const now = { value: 1_000_000 };
    let online = false;
    let resume: (() => void) | undefined;
    const e = {
      ...env(now),
      online: () => online,
      whenOnline: (run: () => void) => {
        resume = run;
      },
    };
    expect(reloadForNewBuild(e)).toBe(true);
    expect(e.reload).not.toHaveBeenCalled();
    online = true;
    resume?.();
    expect(e.reload).toHaveBeenCalledOnce();
  });

  it('still reloads when storage is unavailable or throws', () => {
    const now = { value: 1_000_000 };
    const noStorage = { ...env(now), storage: undefined };
    expect(reloadForNewBuild(noStorage)).toBe(true);
    const throwing = env(now, {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(reloadForNewBuild(throwing)).toBe(true);
    expect(throwing.reload).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultStaleBuildEnv,
  installStaleBuildReload,
  isChunkLoadError,
  reloadForNewBuild,
  type StaleBuildEnv,
} from './staleBuild';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

type TestEnv = StaleBuildEnv & {
  reload: ReturnType<typeof vi.fn<() => void>>;
  warn: ReturnType<typeof vi.fn<(message: string) => void>>;
  goOnline: () => void;
  setOnline: (value: boolean) => void;
};

function env(now: { value: number }, storage = memoryStorage()): TestEnv {
  let online = true;
  const waiting: (() => void)[] = [];
  return {
    reload: vi.fn<() => void>(),
    warn: vi.fn<(message: string) => void>(),
    online: () => online,
    whenOnline: (run) => {
      waiting.push(run);
    },
    storage,
    now: () => now.value,
    setOnline: (value) => {
      online = value;
    },
    goOnline: () => {
      online = true;
      for (const run of waiting.splice(0)) run();
    },
  };
}

class FakeTarget {
  private listeners: ((event: Event) => void)[] = [];
  addEventListener(_type: string, listener: (event: Event) => void) {
    this.listeners.push(listener);
  }
  dispatch(): Event {
    const event = new Event('vite:preloadError', { cancelable: true });
    for (const listener of this.listeners) listener(event);
    return event;
  }
}

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://nthstock-a13a5.web.app/assets/dashboard-ul55Qa07.js',
    'error loading dynamically imported module: https://example.test/assets/a.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/index.css',
    'Loading chunk 42 failed.',
  ])('recognises "%s"', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it('recognises a ChunkLoadError by name', () => {
    const error = new Error('x');
    error.name = 'ChunkLoadError';
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('ignores other errors and non-errors', () => {
    expect(isChunkLoadError(new Error('Request failed with 500'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('reloadForNewBuild', () => {
  it('reloads once, then not again within a minute (with a warning), then again after it', () => {
    const now = { value: 1_000_000 };
    const e = env(now);
    expect(reloadForNewBuild(e)).toBe(true);
    now.value += 30_000;
    expect(reloadForNewBuild(e)).toBe(false);
    expect(e.warn).toHaveBeenCalledOnce();
    now.value += 31_000;
    expect(reloadForNewBuild(e)).toBe(true);
    expect(e.reload).toHaveBeenCalledTimes(2);
  });

  it('offline, waits for the network with one pending reload, then reloads', () => {
    const now = { value: 1_000_000 };
    const e = env(now);
    e.setOnline(false);
    expect(reloadForNewBuild(e)).toBe(true);
    now.value += 61_000;
    expect(reloadForNewBuild(e)).toBe(true);
    expect(e.reload).not.toHaveBeenCalled();
    e.goOnline();
    expect(e.reload).toHaveBeenCalledOnce();
  });

  it('treats a corrupt stored time as no reload yet', () => {
    const garbage = env(
      { value: 1_000_000 },
      { getItem: () => 'not a number', setItem: () => undefined },
    );
    expect(reloadForNewBuild(garbage)).toBe(true);
    expect(garbage.reload).toHaveBeenCalledOnce();
  });

  it('never reloads by itself without working storage, which could loop', () => {
    const now = { value: 1_000_000 };
    const noStorage = { ...env(now), storage: undefined };
    expect(reloadForNewBuild(noStorage)).toBe(false);
    const throwing = env(now, {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(reloadForNewBuild(throwing)).toBe(false);
    expect(throwing.reload).not.toHaveBeenCalled();
    expect(throwing.warn).toHaveBeenCalledOnce();
  });
});

describe('installStaleBuildReload', () => {
  it('cancels the first preload error and reloads; lets one within a minute reach the route', () => {
    const now = { value: 1_000_000 };
    const e = env(now);
    const target = new FakeTarget();
    installStaleBuildReload(target, e);
    expect(target.dispatch().defaultPrevented).toBe(true);
    expect(e.reload).toHaveBeenCalledOnce();
    now.value += 10_000;
    expect(target.dispatch().defaultPrevented).toBe(false);
    expect(e.reload).toHaveBeenCalledOnce();
  });

  it('offline, cancels the error and reloads once back online', () => {
    const e = env({ value: 1_000_000 });
    e.setOnline(false);
    const target = new FakeTarget();
    installStaleBuildReload(target, e);
    expect(target.dispatch().defaultPrevented).toBe(true);
    expect(e.reload).not.toHaveBeenCalled();
    e.goOnline();
    expect(e.reload).toHaveBeenCalledOnce();
  });
});

describe('defaultStaleBuildEnv', () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('uses session storage, navigator.onLine and the window online event', () => {
    const e = defaultStaleBuildEnv();
    expect(e.online()).toBe(navigator.onLine);
    e.storage?.setItem('k', 'v');
    expect(window.sessionStorage.getItem('k')).toBe('v');
    const run = vi.fn();
    e.whenOnline(run);
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    expect(run).toHaveBeenCalledOnce();
  });
});

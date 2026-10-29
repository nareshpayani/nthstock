import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_PENDING_STORAGE_KEY,
  clearDemoPending,
  enterDemoMode,
  isDemoMode,
  markDemoPending,
  mockBackendStarted,
  setMockBackendStart,
  setDemoStarter,
  startDemo,
} from './demoSimulator';

const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

afterEach(() => {
  setDemoStarter(null);
  window.sessionStorage.clear();
});

describe('Try demo seam (TFC-12)', () => {
  it('is ready with no starter, as in api mode', () => {
    expect(startDemo()).toBe('ready');
  });

  it('returns what the registered starter says', () => {
    setDemoStarter(() => 'reloading');
    expect(startDemo()).toBe('reloading');
  });

  it('marks and clears the pending flag', () => {
    expect(markDemoPending(window.sessionStorage)).toBe(true);
    expect(window.sessionStorage.getItem(DEMO_PENDING_STORAGE_KEY)).toBe('1');
    clearDemoPending(window.sessionStorage);
    expect(window.sessionStorage.getItem(DEMO_PENDING_STORAGE_KEY)).toBeNull();
  });

  it('survives storage that throws', () => {
    expect(markDemoPending(throwing)).toBe(false);
    expect(() => clearDemoPending(throwing)).not.toThrow();
    expect(() => enterDemoMode(throwing)).not.toThrow();
    expect(isDemoMode(throwing)).toBe(false);
  });
});

describe('mockBackendStarted (NSTOCK-0469)', () => {
  afterEach(() => {
    setMockBackendStart(Promise.resolve());
  });

  it('waits for the mock worker to start, and settles when it fails too', async () => {
    let start: () => void = () => undefined;
    setMockBackendStart(
      new Promise<void>((resolve) => {
        start = resolve;
      }),
    );
    const done = vi.fn();
    void mockBackendStarted().then(done);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    start();
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1));

    setMockBackendStart(Promise.reject(new Error('no worker')));
    await expect(mockBackendStarted()).resolves.toBeUndefined();
  });
});

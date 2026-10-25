import { afterEach, describe, expect, it } from 'vitest';
import {
  DEMO_PENDING_STORAGE_KEY,
  clearDemoPending,
  enterDemoMode,
  isDemoMode,
  markDemoPending,
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

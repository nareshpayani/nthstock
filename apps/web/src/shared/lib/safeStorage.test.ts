import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeStorage } from './safeStorage';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('safeStorage', () => {
  it('reads and writes localStorage', () => {
    safeStorage.set('k', 'v');
    expect(safeStorage.get('k')).toBe('v');
  });

  it('swallows errors when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(safeStorage.get('k')).toBeNull();
    expect(() => safeStorage.set('k', 'v')).not.toThrow();
  });
});

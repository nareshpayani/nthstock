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
    safeStorage.remove('k');
    expect(safeStorage.get('k')).toBeNull();
  });

  it('swallows errors when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(safeStorage.get('k')).toBeNull();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => safeStorage.set('k', 'v')).not.toThrow();
    expect(() => safeStorage.remove('k')).not.toThrow();
  });
});

/**
 * localStorage that never throws. Private windows, blocked site data and quota errors all fall
 * back to "nothing stored", so the UI still renders (T-027).
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /** Whether the value was stored: a caller that must not lose it can say so. */
  set(key: string, value: string): boolean {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      // Storage is a convenience only; most callers ignore failures.
      return false;
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  },
};

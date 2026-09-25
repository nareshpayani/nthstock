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
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage is a convenience only; ignore failures.
    }
  },
};

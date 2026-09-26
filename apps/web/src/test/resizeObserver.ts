import { vi } from 'vitest';

type Callback = (entries: { contentRect: { width: number; height: number } }[]) => void;

/**
 * Installs a controllable ResizeObserver (jsdom has none). `observers` lists live instances;
 * `resize(width)` fires every observer as if its element changed size.
 */
export function installResizeObserver() {
  const observers = new Set<{ callback: Callback; disconnect: () => void }>();
  class FakeResizeObserver {
    private readonly entry: { callback: Callback; disconnect: () => void };
    constructor(callback: Callback) {
      this.entry = { callback, disconnect: () => observers.delete(this.entry) };
    }
    observe() {
      observers.add(this.entry);
    }
    unobserve() {
      observers.delete(this.entry);
    }
    disconnect() {
      this.entry.disconnect();
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return {
    observers,
    resize(width: number, height = 0) {
      for (const observer of observers) observer.callback([{ contentRect: { width, height } }]);
    },
  };
}

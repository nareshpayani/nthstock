import { vi } from 'vitest';

type Callback = (entries: { isIntersecting: boolean; target: Element }[]) => void;

/**
 * Installs a controllable IntersectionObserver (jsdom has none). `observed` lists the elements
 * being watched; `setInView(inView)` fires every observer as if its elements scrolled in or out.
 */
export function installIntersectionObserver() {
  const observers = new Set<{ callback: Callback; targets: Set<Element> }>();
  class FakeIntersectionObserver {
    private readonly entry: { callback: Callback; targets: Set<Element> };
    constructor(callback: Callback) {
      this.entry = { callback, targets: new Set() };
      observers.add(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.add(target);
    }
    unobserve(target: Element) {
      this.entry.targets.delete(target);
    }
    disconnect() {
      this.entry.targets.clear();
      observers.delete(this.entry);
    }
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  return {
    observed(): Element[] {
      return [...observers].flatMap((observer) => [...observer.targets]);
    },
    setInView(inView: boolean) {
      for (const { callback, targets } of observers) {
        if (targets.size === 0) continue;
        callback([...targets].map((target) => ({ isIntersecting: inView, target })));
      }
    },
  };
}

/** Sets `document.visibilityState` and fires `visibilitychange`, as switching tabs would. */
export function setPageVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

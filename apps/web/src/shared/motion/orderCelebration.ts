/**
 * The order-placed moment on screen: the nth mark pops in and draws its rising line, with
 * "Order placed" or "Order filled" under it, for about a second. One overlay in the app shell
 * listens; the order ticket calls `celebrateOrder`. The words are already in the toast, so the
 * overlay is decoration and screen readers skip it.
 */
export type OrderCelebrationKind = 'placed' | 'filled';

export type OrderCelebration = { readonly id: number; readonly kind: OrderCelebrationKind };

type Listener = (celebration: OrderCelebration) => void;

const listeners = new Set<Listener>();
let nextId = 1;

export function celebrateOrder(kind: OrderCelebrationKind): void {
  const celebration = { id: nextId++, kind };
  for (const listener of listeners) {
    // Decoration must never stop the order flow that called it (the toast, the sheet closing).
    try {
      listener(celebration);
    } catch (error) {
      console.error('The order-placed moment failed', error);
    }
  }
}

/** Returns the unsubscribe. */
export function subscribeOrderCelebrations(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The key of one fill event (T11): the order id for the final fill, so the ticket and the listener
 * agree on it, and the id with the filled quantity for each partial fill, so every partial toasts.
 */
export function fillEventKey(order: { id: string; status: string; filledQty: number }): string {
  return order.status === 'EXECUTED' ? order.id : `${order.id}@${String(order.filledQty)}`;
}

/**
 * "Order executed" is toasted once per order, whoever learns of the fill first (T-147): the
 * order ticket from its place or modify response, or the order-update listener from the
 * WebSocket. Both call `claimFillToast` and toast only when it returns true.
 */
const claimed = new Set<string>();
const MAX_REMEMBERED = 500;

export function claimFillToast(key: string): boolean {
  if (claimed.has(key)) return false;
  claimed.add(key);
  if (claimed.size > MAX_REMEMBERED) {
    const oldest = claimed.values().next().value;
    if (oldest !== undefined) claimed.delete(oldest);
  }
  return true;
}

/** Tests only: forget every claim. */
export function resetFillToasts(): void {
  claimed.clear();
}

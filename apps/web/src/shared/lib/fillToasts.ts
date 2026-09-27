/**
 * "Order executed" is toasted once per order, whoever learns of the fill first (T-147): the
 * order ticket from its place or modify response, or the order-update listener from the
 * WebSocket. Both call `claimFillToast` and toast only when it returns true.
 */
const claimed = new Set<string>();
const MAX_REMEMBERED = 500;

export function claimFillToast(orderId: string): boolean {
  if (claimed.has(orderId)) return false;
  claimed.add(orderId);
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

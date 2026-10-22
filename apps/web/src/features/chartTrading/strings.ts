export const strings = {
  group: (symbol: string) => `Chart orders for ${symbol}`,
  ghost: {
    label: (price: string) => `New order @ ${price}`,
    description: (price: string) =>
      `New order at ${price}. Arrow keys move one tick, Shift for ten, Enter saves, Escape restores, Delete removes.`,
  },
  order: {
    sides: { BUY: 'Buy', SELL: 'Sell' },
    label: (side: string, qty: number, price: string) => `${side} ${String(qty)} @ ${price}`,
    description: (side: string, qty: number, price: string) =>
      `${side} limit, ${String(qty)} shares at ${price}. Drag, or use the arrow keys (one tick, Shift for ten), to move it; Enter saves, Escape restores, Delete cancels.`,
    updating: (price: string) => `Updating… ${price}`,
    cancelDescription: (side: string, qty: number, price: string) =>
      `Cancel the ${side.toLowerCase()} limit for ${String(qty)} at ${price}`,
    confirmCancel: 'Cancel?',
    confirmCancelDescription: (side: string, qty: number, price: string) =>
      `Tap again to cancel the ${side.toLowerCase()} limit for ${String(qty)} at ${price}`,
    modified: 'Order modified',
    modifiedBody: (side: string, qty: number, price: string) =>
      `${side} ${String(qty)} now at ${price}.`,
    modifyFailed: 'Order not modified',
    cancelled: 'Order cancelled',
    cancelledBody: (side: string, qty: number, price: string) =>
      `${side} ${String(qty)} at ${price} is cancelled.`,
    cancelFailed: 'Order not cancelled',
    filledFirst: (price: string) => `Filled at ${price} before your change`,
    cancelledFirst: 'Cancelled before your change',
    goneTitle: 'Change not sent',
  },
} as const;

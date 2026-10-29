export const strings = {
  /** Offline (SPEC-CR-1 §7): lines are locked and their names say why. */
  locked: 'Locked while offline; changes resume when you reconnect.',
  drag: {
    /** The first-run hint beside the first draggable line (SPEC-CR-1 §5.7, CR-T20). */
    hint: 'Drag the line to change the price',
    started: (label: string, price: string) =>
      `Moving ${label}. Now ${price}. Release to save, a second finger or Escape cancels.`,
    /** Keyboard moves (§13) say their own keys. */
    keyStarted: (label: string, price: string) =>
      `Moving ${label}. Now ${price}. Enter saves, Escape cancels.`,
    /** The save's outcome is the toast's to say; nothing is sent for an unchanged price. */
    released: (price: string) => `Moved to ${price}.`,
    cancelled: 'Move cancelled. The line is back where it was.',
    /** In the loupe while the thumb has slid sideways to slow the drag (A10). */
    fine: 'Fine',
  },
  loupe: {
    atLtp: 'At LTP',
    fromLtp: (percent: string) => `${percent} from LTP`,
    value: (qty: string, price: string, total: string) => `${qty} × ${price} = ${total}`,
    pnl: (pnl: string) => `Est. P&L ${pnl}`,
  },
  group: (symbol: string) => `Chart orders for ${symbol}`,
  /** Price-axis zoom (NSTOCK-0436): drag the axis, then "Auto" fits the prices again. */
  priceZoom: {
    auto: 'Auto',
    autoLabel: 'Auto: fit prices to the chart',
    fitted: 'Prices fit to the chart.',
  },
  ghost: {
    label: (price: string) => `New order @ ${price}`,
    description: (price: string) =>
      `New order at ${price}. Arrow keys move one tick, Shift for ten, Enter saves, Escape restores, Delete removes.`,
    buy: 'Buy',
    sell: 'Sell',
    buyDescription: (price: string) => `Buy at ${price}: review before placing`,
    sellDescription: (price: string) => `Sell at ${price}: review before placing`,
  },
  position: {
    label: (qty: string, avg: string, pnl: string) => `${qty} @ ${avg} · ${pnl}`,
    long: 'Long',
    short: 'Short',
    description: (direction: string, qty: number, avg: string, pnl: string, stop: string | null) =>
      `${direction} ${String(qty)} shares at ${avg}, P&L ${pnl}. ${stop ? `Trailing stop: ${stop}. Open to change it.` : 'Open to set a trailing stop.'}`,
  },
  stop: {
    label: (name: string, price: string, trail: string, status: string) =>
      `${name} ${price} · ${trail} · ${status}`,
    description: (price: string, trail: string, status: string) =>
      `Trailing stop at ${price}, trailing by ${trail}, ${status.toLowerCase()}. Open to change it.`,
    dragDescription: (price: string, trail: string) =>
      `Trailing stop at ${price}, trailing by ${trail}. Drag, or use the arrow keys (one tick, Shift for ten), to move the stop and change the trail; Enter saves, Escape restores.`,
    updating: (price: string) => `Saving… ${price}`,
    activation: (price: string) => `Activates at ${price}`,
    activationDescription: (price: string) =>
      `The trailing stop starts trailing once the price reaches ${price}. Open to change it.`,
    moved: 'Trailing stop updated',
    movedBody: (price: string, trail: string) => `Stop now ${price}, trailing by ${trail}.`,
    moveFailed: 'Trailing stop not changed',
  },
  order: {
    sides: { BUY: 'Buy', SELL: 'Sell' },
    label: (side: string, qty: number, price: string) => `${side} ${String(qty)} @ ${price}`,
    description: (side: string, qty: number, price: string) =>
      `${side} limit, ${String(qty)} shares at ${price}. Drag, or use the arrow keys (one tick, Shift for ten), to move it; Enter saves, Escape restores, Delete cancels.`,
    updating: (price: string) => `Saving… ${price}`,
    cancelDescription: (side: string, qty: number, price: string) =>
      `Cancel the ${side.toLowerCase()} limit for ${String(qty)} at ${price}`,
    confirmCancel: 'Cancel?',
    confirmCancelDescription: (side: string, qty: number, price: string) =>
      `Press again to cancel the ${side.toLowerCase()} limit for ${String(qty)} at ${price}`,
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

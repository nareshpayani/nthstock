/** Copy for the scalper pad (T21, T22, SPEC-TFC-1 §11). */
export const strings = {
  pad: (symbol: string) => `Scalper for ${symbol}`,
  qty: {
    label: 'Quantity',
    preset: (qty: number) => `${String(qty)} shares`,
    custom: 'Custom quantity',
    customHint: 'Your size',
  },
  arm: {
    label: 'Arm',
    description:
      'Turn on to trade in one tap. Off, the pad sends nothing. It turns off after 2 minutes without a trade, or when you leave the page.',
    idle: 'Disarmed: 2 minutes without a trade.',
    hidden: 'Disarmed: you left the page.',
  },
  buy: { label: 'Buy at ask' },
  sell: { label: 'Sell at bid' },
  orderDescription: (side: 'BUY' | 'SELL', qty: number, symbol: string) =>
    `${side === 'BUY' ? 'Buys' : 'Sells'} ${String(qty)} ${symbol} intraday at this price or better, at once. Whatever does not fill is cancelled.`,
  flatten: {
    label: 'Flatten',
    description: (symbol: string) =>
      `Closes your whole intraday ${symbol} position at market, and cancels its trailing stop and open orders.`,
    flat: 'No position',
    exit: (side: 'BUY' | 'SELL', qty: number) =>
      `${side === 'BUY' ? 'Buy' : 'Sell'} ${String(qty)}`,
  },
  reverse: {
    label: 'Reverse',
    hold: 'Hold to reverse',
    description: (symbol: string) =>
      `Hold for 0.4 seconds, or hold Enter or Space. Closes your intraday ${symbol} position, then opens the same size the other way at the touch.`,
  },
  armToTrade: 'Arm to trade',
  waiting: 'Waiting for prices',
  ack: {
    label: 'Last scalp order',
    sending: (verb: 'Buying' | 'Selling', qty: number) => `${verb} ${String(qty)}…`,
    filled: (verb: 'Bought' | 'Sold', qty: number, price: string) =>
      `${verb} ${String(qty)} @ ${price}`,
    partial: (verb: 'Bought' | 'Sold', filled: number, qty: number, price: string) =>
      `${verb} ${String(filled)} of ${String(qty)} @ ${price} · rest cancelled`,
    unfilled: 'Not filled: the price moved. Nothing was bought or sold.',
    rejected: (reason: string) => `Rejected: ${reason}`,
    failed: 'Not sent. Check your connection and try again.',
    closing: 'Closing position…',
    reversing: 'Reversing…',
    closed: (verb: 'Bought' | 'Sold', qty: number, price: string) =>
      `Closed: ${verb.toLowerCase()} ${String(qty)} @ ${price}`,
    partlyClosed: (left: number) => `Partly closed: ${String(left)} left`,
    notClosed: 'Not closed: nothing filled. Try again.',
    reversed: (text: string) => `Reversed: ${text}`,
    reverseUnfilled: 'Closed, but the reverse entry did not fill: the price moved.',
    reverseRejected: (reason: string) => `Closed, but the reverse entry was rejected: ${reason}`,
  },
  toast: {
    filled: 'Scalp filled',
    partial: 'Scalp partly filled',
    unfilled: 'Scalp not filled',
    rejected: 'Scalp rejected',
    closed: 'Position closed',
    partlyClosed: 'Position partly closed',
    description: (side: 'BUY' | 'SELL', filled: number, symbol: string, price: string) =>
      `${side} ${String(filled)} ${symbol} @ ${price}`,
  },
} as const;

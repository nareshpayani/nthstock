/** Copy for the scalper pad (T21, SPEC-TFC-1 §11). */
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
    description: 'Turn on to trade in one tap. Off, the pad sends nothing.',
  },
  buy: { label: 'Buy at ask' },
  sell: { label: 'Sell at bid' },
  orderDescription: (side: 'BUY' | 'SELL', qty: number, symbol: string) =>
    `${side === 'BUY' ? 'Buys' : 'Sells'} ${String(qty)} ${symbol} intraday at this price or better, at once. Whatever does not fill is cancelled.`,
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
  },
  toast: {
    filled: 'Scalp filled',
    partial: 'Scalp partly filled',
    unfilled: 'Scalp not filled',
    rejected: 'Scalp rejected',
    description: (side: 'BUY' | 'SELL', filled: number, symbol: string, price: string) =>
      `${side} ${String(filled)} ${symbol} @ ${price}`,
  },
} as const;

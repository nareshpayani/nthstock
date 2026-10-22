export const strings = {
  group: (symbol: string) => `Chart orders for ${symbol}`,
  ghost: {
    label: (price: string) => `New order @ ${price}`,
    description: (price: string) =>
      `New order at ${price}. Arrow keys move one tick, Shift for ten, Enter saves, Escape restores, Delete removes.`,
  },
} as const;

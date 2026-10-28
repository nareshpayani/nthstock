export const strings = {
  tickersLabel: 'Market indices',
  loading: 'loading',
  open: 'Market open',
  preOpen: 'Pre-open',
  closed: 'Market closed',
  holiday: (name: string) => `Holiday: ${name}`,
  opens: (when: string) => `opens ${when} IST`,
  closes: 'closes 3:30 pm IST',
  /** msw mode with VITE_MOCK_MARKET_OPEN: the mock market ticks at any hour. */
  mockOpen: 'mock market, open at any hour',
  statusLabel: 'NSE market status',
  /** The phone header's one-word status beside its dot. */
  short: { open: 'Open', closed: 'Closed', holiday: 'Holiday' },
} as const;

export const strings = {
  tickersLabel: 'Market indices',
  sampleNote: 'Sample values until live market data is connected',
  open: 'Market open',
  preOpen: 'Pre-open',
  closed: 'Market closed',
  holiday: (name: string) => `Holiday: ${name}`,
  opens: (when: string) => `opens ${when} IST`,
  closes: 'closes 3:30 pm IST',
  statusLabel: 'NSE market status',
} as const;

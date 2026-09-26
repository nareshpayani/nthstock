export const strings = {
  title: 'Market indices',
  keyboardHint: 'Use the left and right arrow keys to scroll the cards.',
  loading: 'Loading market indices',
  sparklineLabel: (name: string) => `${name} intraday trend`,
  errorTitle: 'Indices unavailable',
  errorBody: 'Market indices could not load.',
  retry: 'Retry',
} as const;

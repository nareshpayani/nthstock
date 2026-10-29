import type { PriceAlertCondition } from '@nthstock/contracts';

/** UI copy for price alerts and the notification centre (NSTOCK-0344). */
export const strings = {
  bell: {
    label: 'Notifications',
    labelUnread: (count: number) => `Notifications, ${String(count)} unread`,
    badge: (count: number) => (count > 9 ? '9+' : String(count)),
  },
  centre: {
    title: 'Notifications',
    description: 'Price alerts that fired, executed orders and trailing stops. Times are in IST.',
    tabsLabel: 'Notification views',
    tabs: { notifications: 'Notifications', alerts: 'Price alerts' },
    markAllRead: 'Mark all read',
    empty: 'Nothing yet',
    emptyBody: 'Set a price alert from any stock page, and fills and alerts will show up here.',
    unread: 'Unread',
    loadError: 'Notifications could not load.',
    alertsLoadError: 'Price alerts could not load.',
    loading: 'Loading',
    retry: 'Try again',
    markReadError: 'Notifications could not be marked read. Try again.',
  },
  alerts: {
    empty: 'No price alerts',
    emptyBody: 'Open a stock and tap the bell next to its name to set one.',
    active: 'Active',
    triggered: 'Triggered',
    cancelled: 'Cancelled',
    remove: (symbol: string) => `Remove the ${symbol} alert`,
    removed: (symbol: string) => `${symbol} alert removed.`,
    removeError: (symbol: string) => `The ${symbol} alert could not be removed. Try again.`,
    rule: (condition: PriceAlertCondition, price: string) =>
      condition === 'ABOVE' ? `Rises to ${price}` : `Falls to ${price}`,
    firedAt: (price: string, time: string) => `Fired at ${price}, ${time} IST`,
  },
  dialog: {
    open: (symbol: string) => `Set a price alert for ${symbol}`,
    openActive: (symbol: string, count: number) =>
      `Price alerts for ${symbol}, ${String(count)} active`,
    title: (symbol: string) => `Price alert for ${symbol}`,
    description: 'Get a notification the moment the price reaches your level, once.',
    priceLabel: 'Alert price',
    now: (price: string) => `Now ${price}`,
    presetsLabel: 'Quick levels',
    preset: (pct: number) => `${pct > 0 ? '+' : '−'}${String(Math.abs(pct))}%`,
    presetLabel: (pct: number) => `${pct > 0 ? 'Up' : 'Down'} ${String(Math.abs(pct))} percent`,
    noteLabel: 'Note (optional)',
    notePlaceholder: 'e.g. Breakout above resistance',
    when: (symbol: string, condition: PriceAlertCondition, price: string) =>
      condition === 'ABOVE'
        ? `Alert when ${symbol} rises to ${price} or above.`
        : `Alert when ${symbol} falls to ${price} or below.`,
    samePrice: 'Pick a level above or below the current price.',
    create: 'Set alert',
    cancel: 'Close',
    created: (symbol: string, price: string) => `Alert set: ${symbol} at ${price}.`,
    activeTitle: 'Active alerts',
    error: 'The alert could not be set. Try again.',
    limit: 'You have 50 active alerts. Remove one to set another.',
    passed: 'The price has already reached that level. Pick another.',
  },
  loginFirst: 'Log in to set price alerts',
  chartLine: 'Alert',
} as const;

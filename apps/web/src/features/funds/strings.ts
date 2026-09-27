import type { LedgerEntryType } from '@nthstock/contracts';

/** UI copy for Funds (T-158 to T-160). Paper trading only: virtual cash, no real money. */
export const strings = {
  title: 'Funds',
  description: 'Virtual cash for paper trading. No real money moves.',
  loading: 'Loading your funds',
  loadError: {
    title: 'Your funds could not load',
    body: 'Check your connection and try again.',
    retry: 'Retry',
  },
  summary: {
    label: 'Funds summary',
    available: 'Available cash',
    blocked: 'Blocked for open orders',
    invested: 'Invested',
    total: 'Total',
    totalHint: 'Cash plus holdings and positions at live prices',
    opening: (amount: string) => `Opening balance ${amount}`,
  },
  ledger: {
    title: 'Ledger',
    label: 'Funds ledger',
    loading: 'Loading the ledger',
    loadingMore: 'Loading older entries',
    end: 'That is the start of your ledger.',
    loadError: 'The ledger could not load.',
    retry: 'Retry',
    empty: 'No entries yet.',
    columns: {
      time: 'Time (IST)',
      type: 'Type',
      details: 'Details',
      amount: 'Amount',
      balanceAfter: 'Balance after',
    },
    types: {
      OPENING_CREDIT: 'Opening credit',
      ORDER_BLOCK: 'Blocked',
      ORDER_RELEASE: 'Released',
      TRADE_DEBIT: 'Buy',
      TRADE_CREDIT: 'Sell',
      RESET: 'Reset',
    } satisfies Record<LedgerEntryType, string>,
    /** Spoken with the signed amount, so the direction is never colour alone. */
    credit: 'credit',
    debit: 'debit',
  },
  reset: {
    open: 'Reset paper balance',
    title: 'Reset your paper balance?',
    description: 'This starts your paper account again. It can’t be undone.',
    clears: 'What happens:',
    items: [
      'Open orders and AMOs are cancelled, and their blocked cash is released.',
      'All positions and holdings are cleared.',
      'Available cash goes back to the opening balance.',
      'The ledger keeps its history and gets a Reset entry.',
    ],
    field: 'Type RESET to confirm',
    hint: 'In capital letters.',
    keep: 'Keep my account',
    confirm: 'Reset balance',
    done: 'Paper balance reset',
    doneBody: (amount: string) => `Available cash is back to ${amount}.`,
    failed: 'Paper balance not reset',
  },
  errors: {
    generic: 'Something went wrong. Try again.',
    network: 'Could not reach nthstock. Check your connection and try again.',
  },
} as const;

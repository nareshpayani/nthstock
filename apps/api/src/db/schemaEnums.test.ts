import {
  Exchange,
  KycStatus,
  LedgerEntryType,
  NotificationKind,
  PriceAlertCondition,
  PriceAlertStatus,
  TrailingStopExitType,
  TrailingStopStatus,
} from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  LEDGER_ENTRY_TYPES,
  TRAIL_UNITS,
  TRAILING_STOP_EXIT_TYPES,
  TRAILING_STOP_STATUSES,
} from './schema/paper.js';
import { PRICE_ALERT_CONDITIONS, PRICE_ALERT_STATUSES } from './schema/alerts.js';
import { NOTIFICATION_KINDS } from './schema/notifications.js';
import { KYC_STATUSES } from './schema/users.js';
import { EXCHANGES } from './schema/watchlists.js';

// Lists the schema repeats from packages/contracts (drizzle-kit cannot load that package).
describe('schema enums', () => {
  it('checks users.kyc_status against the contract KycStatus', () => {
    expect([...KYC_STATUSES]).toEqual(KycStatus.options);
  });

  it('checks ledger_entries.type against the contract LedgerEntryType', () => {
    expect([...LEDGER_ENTRY_TYPES]).toEqual(LedgerEntryType.options);
  });

  it('checks the trailing_stops lists against the contract', () => {
    expect([...TRAILING_STOP_STATUSES]).toEqual(TrailingStopStatus.options);
    expect([...TRAILING_STOP_EXIT_TYPES]).toEqual(TrailingStopExitType.options);
    expect([...TRAIL_UNITS]).toEqual(['AMOUNT', 'PERCENT']);
  });

  it('checks notifications.kind against the contract NotificationKind', () => {
    expect([...NOTIFICATION_KINDS]).toEqual(NotificationKind.options);
  });

  it('checks the price_alerts lists against the contract', () => {
    expect([...PRICE_ALERT_CONDITIONS]).toEqual(PriceAlertCondition.options);
    expect([...PRICE_ALERT_STATUSES]).toEqual(PriceAlertStatus.options);
  });

  it('checks watchlist_items.exchange against the contract Exchange', () => {
    expect([...EXCHANGES]).toEqual(Exchange.options);
  });
});

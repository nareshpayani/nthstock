import { describe, expect, it } from 'vitest';
import {
  fundsSummaryFixture,
  holdingFixture,
  ledgerEntryFixture,
  portfolioSummaryFixture,
  positionFixture,
  resetRequestFixture,
} from './fixtures.js';
import {
  FundsSummary,
  Holding,
  HoldingsResponse,
  LedgerEntry,
  LedgerPage,
  PAPER_OPENING_BALANCE_PAISE,
  PortfolioSummary,
  Position,
  PositionsResponse,
  ResetRequest,
} from './portfolio.js';

describe('portfolio fixtures round-trip', () => {
  it.each([
    ['Position', Position, positionFixture],
    ['PositionsResponse', PositionsResponse, { items: [positionFixture] }],
    ['Holding', Holding, holdingFixture],
    ['HoldingsResponse', HoldingsResponse, { items: [holdingFixture] }],
    ['PortfolioSummary', PortfolioSummary, portfolioSummaryFixture],
    ['FundsSummary', FundsSummary, fundsSummaryFixture],
    ['LedgerEntry', LedgerEntry, ledgerEntryFixture],
    ['LedgerPage', LedgerPage, { items: [ledgerEntryFixture], nextCursor: 'c2' }],
    ['ResetRequest', ResetRequest, resetRequestFixture],
  ] as const)('%s', (_name, schema, fixture) => {
    expect(schema.parse(fixture)).toEqual(fixture);
  });
});

describe('portfolio rules', () => {
  it('opens with ₹10,00,000 in paise', () => {
    expect(PAPER_OPENING_BALANCE_PAISE).toBe(100_000_000);
  });

  it('rejects float paise in money fields', () => {
    expect(Holding.safeParse({ ...holdingFixture, avgPrice: 1400.5 }).success).toBe(false);
    expect(LedgerEntry.safeParse({ ...ledgerEntryFixture, amount: 0.1 }).success).toBe(false);
  });

  it('requires available to equal balance minus blocked', () => {
    const result = FundsSummary.safeParse({
      ...fundsSummaryFixture,
      available: fundsSummaryFixture.balance,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['available']);
  });

  it('requires typing RESET exactly', () => {
    expect(ResetRequest.safeParse({ confirm: 'reset' }).success).toBe(false);
    expect(ResetRequest.safeParse({}).success).toBe(false);
  });

  it('rejects a zero-quantity holding', () => {
    expect(Holding.safeParse({ ...holdingFixture, qty: 0 }).success).toBe(false);
  });
});

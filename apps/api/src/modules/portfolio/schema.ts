/**
 * The portfolio module stores nothing of its own. Positions, holdings and the summary are read
 * from each user's paper account (the orders module's `PaperEngine`, ADR 0004) and valued at the
 * current LTP on every request; their response schemas live in `packages/contracts`
 * (`portfolio.ts`). Phase 3 keeps this shape: the orders repo loads the account, this module
 * values it.
 */
export type PortfolioUserId = string;

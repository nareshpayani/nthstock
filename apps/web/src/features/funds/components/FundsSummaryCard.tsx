import type { FundsSummary, Holding, Position } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import type { ReactNode } from 'react';
import { useLiveHoldings } from '@/features/holdings';
import { useLivePositions } from '@/features/positions';
import { fundsTotals } from '../model/fundsTotals';
import { strings } from '../strings';

function Figure({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1">
      <dt className="text-label text-ink-muted">{label}</dt>
      <dd className="font-mono text-lg font-semibold text-ink tabular-nums">{children}</dd>
      {hint ? <dd className="text-label text-ink-muted">{hint}</dd> : null}
    </div>
  );
}

export type FundsSummaryCardProps = {
  funds: FundsSummary;
  positions: readonly Position[];
  holdings: readonly Holding[];
};

/**
 * The funds summary (T-158): available cash first, then cash blocked for open orders, what is
 * invested, and the total (cash plus holdings and positions at live prices), with the ₹10,00,000
 * opening balance. Re-renders on ticks of the held symbols only.
 */
export function FundsSummaryCard({ funds, positions, holdings }: FundsSummaryCardProps) {
  const livePositions = useLivePositions(positions);
  const liveHoldings = useLiveHoldings(holdings);
  const totals = fundsTotals(funds, livePositions.rows, liveHoldings.totals);
  return (
    <section
      aria-label={strings.summary.label}
      className="grid gap-4 rounded-lg border border-line bg-surface p-4 lg:p-5"
    >
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Figure label={strings.summary.available}>
          <span className="text-title">{formatInr(totals.available)}</span>
        </Figure>
        <Figure label={strings.summary.blocked}>{formatInr(totals.blocked)}</Figure>
        <Figure label={strings.summary.invested}>{formatInr(totals.invested)}</Figure>
        <Figure label={strings.summary.total} hint={strings.summary.totalHint}>
          {formatInr(totals.total)}
        </Figure>
      </dl>
      <p className="text-label text-ink-muted">
        {strings.summary.opening(formatInr(totals.openingBalance))}
      </p>
    </section>
  );
}

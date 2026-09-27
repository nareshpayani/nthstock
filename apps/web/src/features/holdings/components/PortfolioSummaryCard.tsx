import { formatInr } from '@nthstock/utils';
import type { ReactNode } from 'react';
import { PnlAmount } from '@/shared/components/PnlAmount';
import type { LiveHoldingsTotals } from '../model/liveHoldings';
import { strings } from '../strings';

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1">
      <dt className="text-label text-ink-muted">{label}</dt>
      <dd className="font-mono text-lg font-semibold text-ink tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * The live portfolio summary at the top of Portfolio (T-152): invested, current value, total P&L
 * and the day's P&L, from the same live totals as the holdings rows, so after every tick they
 * equal the sums of the rows.
 */
export function PortfolioSummaryCard({ totals }: { totals: LiveHoldingsTotals }) {
  return (
    <section
      aria-label={strings.summary.label}
      className="rounded-lg border border-line bg-surface p-4 lg:p-5"
    >
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Figure label={strings.summary.invested}>{formatInr(totals.investedValue)}</Figure>
        <Figure label={strings.summary.current}>{formatInr(totals.currentValue)}</Figure>
        <Figure label={strings.summary.total}>
          <PnlAmount value={totals.totalPnl} basisPoints={totals.totalPnlBp} />
        </Figure>
        <Figure label={strings.summary.day}>
          <PnlAmount value={totals.dayPnl} basisPoints={totals.dayPnlBp} />
        </Figure>
      </dl>
    </section>
  );
}

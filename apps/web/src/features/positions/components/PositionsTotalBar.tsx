import type { Position } from '@nthstock/contracts';
import { PnlAmount } from '@/shared/components/PnlAmount';
import { useLivePositions } from '../hooks/useLivePositions';
import { strings } from '../strings';

/**
 * The pinned total P&L bar (T-149): realised plus unrealised over every position, live on each
 * tick of any of their symbols, with the two parts beside it. It sticks to the bottom of the
 * screen while the positions scroll. Not a live region: announcing every tick would drown a
 * screen reader.
 */
export function PositionsTotalBar({ positions }: { positions: readonly Position[] }) {
  const { totals } = useLivePositions(positions);
  return (
    <section
      aria-label={strings.total.label}
      className="sticky bottom-0 z-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 shadow-overlay"
    >
      <div className="grid">
        <span className="text-label text-ink-muted">{strings.total.label}</span>
        <PnlAmount value={totals.pnl} size="lg" />
      </div>
      <dl className="flex gap-6">
        <div className="grid">
          <dt className="text-label text-ink-muted">{strings.total.realised}</dt>
          <dd>
            <PnlAmount value={totals.realisedPnl} size="sm" />
          </dd>
        </div>
        <div className="grid">
          <dt className="text-label text-ink-muted">{strings.total.unrealised}</dt>
          <dd>
            <PnlAmount value={totals.unrealisedPnl} size="sm" />
          </dd>
        </div>
      </dl>
    </section>
  );
}

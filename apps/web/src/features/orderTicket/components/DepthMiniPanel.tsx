import type { DepthLevel } from '@nthstock/contracts';
import { DEPTH_LEVELS } from '@nthstock/contracts';
import { Skeleton, cn } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useApiClient } from '@/shared/lib/apiClientContext';
import {
  TICKET_DEPTH_REFRESH_MS,
  ticketDepthQuery,
  type TicketInstrument,
} from '../api/ticketQueries';
import { strings } from '../strings';

export type DepthMiniPanelProps = {
  instrument: TicketInstrument;
  /** Refresh while the market is open; a closed book holds still. */
  live: boolean;
  /** A price was picked: the ticket fills it in as the limit price. */
  onPick: (price: number) => void;
};

const ROWS = Array.from({ length: DEPTH_LEVELS }, (_, i) => i);
const count = new Intl.NumberFormat('en-IN');

type SideProps = {
  side: 'bid' | 'offer';
  levels: readonly DepthLevel[] | undefined;
  onPick: (price: number) => void;
};

/**
 * One side of the book: five buttons, best first. The column is named in text (Bids, Offers),
 * so colour is never the only way to tell the sides apart.
 */
function DepthColumn({ side, levels, onPick }: SideProps) {
  const caption = side === 'bid' ? strings.depth.bids : strings.depth.offers;
  const label = side === 'bid' ? strings.depth.pickBid : strings.depth.pickOffer;
  return (
    <div className="grid content-start gap-1" data-side={side}>
      <p className="text-label font-semibold text-ink">{caption}</p>
      <ul className="grid gap-1">
        {ROWS.map((i) => {
          const level = levels?.[i];
          return (
            <li key={i}>
              {level ? (
                <button
                  type="button"
                  onClick={() => onPick(level.price)}
                  aria-label={label(formatInr(level.price), count.format(level.qty))}
                  className="flex h-8 w-full items-center justify-between gap-2 rounded-sm border border-line px-2 font-mono text-label tabular-nums hover:bg-canvas"
                >
                  <span className={cn(side === 'bid' ? 'text-up' : 'text-down')}>
                    {formatInr(level.price)}
                  </span>
                  <span className="text-ink-muted">{count.format(level.qty)}</span>
                </button>
              ) : (
                <Skeleton className="h-8 w-full" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Depth mini-panel inside the ticket (T-137): the top five bids and offers. Clicking a price
 * makes the order a limit order at that price.
 */
export function DepthMiniPanel({ instrument, live, onPick }: DepthMiniPanelProps) {
  const api = useApiClient();
  const titleId = useId();
  const depth = useQuery({
    ...ticketDepthQuery(api, instrument),
    placeholderData: keepPreviousData,
    refetchInterval: live ? TICKET_DEPTH_REFRESH_MS : false,
    refetchIntervalInBackground: false,
  });
  return (
    <section aria-labelledby={titleId} className="grid gap-2">
      <div className="grid gap-0.5">
        <h3 id={titleId} className="text-body font-semibold text-ink">
          {strings.depth.title}
        </h3>
        <p className="text-label text-ink-muted">{strings.depth.hint}</p>
      </div>
      {depth.isError && !depth.data ? (
        <p className="text-label text-ink-muted">{strings.depth.error}</p>
      ) : (
        <div
          className="grid grid-cols-2 gap-3"
          {...(depth.data ? {} : { role: 'status', 'aria-label': strings.depth.loading })}
        >
          <DepthColumn side="bid" levels={depth.data?.bids} onPick={onPick} />
          <DepthColumn side="offer" levels={depth.data?.asks} onPick={onPick} />
        </div>
      )}
    </section>
  );
}

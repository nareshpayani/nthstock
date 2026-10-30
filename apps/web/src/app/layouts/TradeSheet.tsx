import type { SearchHit } from '@nthstock/contracts';
import { Sheet } from '@nthstock/ui';
import { useRef } from 'react';
import { SearchBox } from '@/features/search';
import { useWatchlistAdder } from '@/features/watchlist';
import { useOpenTicket } from '@/shared/hooks/useOpenTicket';
import { strings } from '../strings';

/** Trade: a pick opens the stock with its ticket. Watchlist: a pick (or its +) adds it to the open list. */
export type TradeSheetMode = 'trade' | 'watchlist';

export type TradeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: TradeSheetMode;
};

/**
 * What the tab bar's Trade button opens on a phone (NSTOCK-0466): a bottom sheet with stock search,
 * recent and popular stocks first. Picking one opens its page with the order ticket already up, so
 * a trade is two taps from any tab.
 */
export function TradeSheet({ open, onOpenChange, mode = 'trade' }: TradeSheetProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const openTicket = useOpenTicket();
  const addTo = useWatchlistAdder();
  // Signed out there is no list to add to, so the sheet trades as usual.
  const adding = mode === 'watchlist' && addTo !== null;
  const choose = (hit: SearchHit) => {
    onOpenChange(false);
    // The search box opens the stock's page; signed out, login returns there, not to this tab.
    // A failure clears the intent and toasts inside useOpenTicket.
    void openTicket(
      { symbol: hit.symbol, exchange: hit.exchange, side: 'BUY' },
      { redirect: `/stocks/${encodeURIComponent(hit.symbol)}` },
    );
  };
  return (
    <Sheet
      side="bottom"
      title={adding ? strings.phone.addTitle(addTo.listName) : strings.phone.tradeTitle}
      description={adding ? strings.phone.addHint : strings.phone.tradeHint}
      open={open}
      onOpenChange={onOpenChange}
      initialFocus={searchRef}
      className="h-[85dvh]"
    >
      <div className="p-4">
        {adding ? (
          <SearchBox ref={searchRef} inline addTo={addTo} chooseAdds />
        ) : (
          <SearchBox ref={searchRef} inline onChoose={choose} />
        )}
      </div>
    </Sheet>
  );
}

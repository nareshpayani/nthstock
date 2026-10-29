import type { SearchHit } from '@nthstock/contracts';
import { Sheet, useToast } from '@nthstock/ui';
import { useNavigate } from '@tanstack/react-router';
import { useRef } from 'react';
import { SearchBox } from '@/features/search';
import { useOpenTicket } from '@/shared/hooks/useOpenTicket';
import { strings } from '../strings';

export type TradeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * What the tab bar's Trade button opens on a phone (NSTOCK-0466): a bottom sheet with stock search,
 * recent and popular stocks first. Picking one opens its page with the order ticket already up, so
 * a trade is two taps from any tab.
 */
export function TradeSheet({ open, onOpenChange }: TradeSheetProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const openTicket = useOpenTicket();
  const toast = useToast();
  const navigate = useNavigate();
  const choose = (hit: SearchHit) => {
    onOpenChange(false);
    const toStock = () => navigate({ to: '/stocks/$symbol', params: { symbol: hit.symbol } });
    // Signed out, the login redirect is the stock's page, so the user lands where they picked.
    openTicket(
      { symbol: hit.symbol, exchange: hit.exchange, side: 'BUY' },
      `/stocks/${encodeURIComponent(hit.symbol)}`,
    )
      .then((result) => (result === 'opened' ? toStock() : undefined))
      .catch(() => {
        // The stock's page still opens; only the ticket did not, so say so and how to open it.
        void toStock();
        toast.show({
          tone: 'error',
          title: strings.phone.tradeFailedTitle,
          description: strings.phone.tradeFailedBody(hit.symbol),
        });
      });
  };
  return (
    <Sheet
      side="bottom"
      title={strings.phone.tradeTitle}
      description={strings.phone.tradeHint}
      open={open}
      onOpenChange={onOpenChange}
      initialFocus={searchRef}
      className="h-[85dvh]"
    >
      <div className="p-4">
        <SearchBox ref={searchRef} inline onChoose={choose} />
      </div>
    </Sheet>
  );
}

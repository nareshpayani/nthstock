import type { SearchHit } from '@nthstock/contracts';
import { Sheet, useToast } from '@nthstock/ui';
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
  const choose = (hit: SearchHit) => {
    onOpenChange(false);
    openTicket({ symbol: hit.symbol, exchange: hit.exchange, side: 'BUY' }).catch(() =>
      toast.show({ title: strings.phone.tradeError, tone: 'error' }),
    );
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

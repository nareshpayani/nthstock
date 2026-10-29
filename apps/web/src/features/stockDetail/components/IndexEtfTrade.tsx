import { INDEX_ETFS, type Instrument, type OrderSide } from '@nthstock/contracts';
import { Button, IconChevronRight, cn } from '@nthstock/ui';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { LiveChange } from '@/shared/components/LiveChange';
import { PriceCell } from '@/shared/components/PriceCell';
import { useOpenTicket } from '@/shared/hooks/useOpenTicket';
import { strings } from '../strings';

export type IndexEtfTradeProps = {
  /** The index whose page this is. */
  index: Instrument;
  /** A phone: a one-line note here and a trade bar fixed to the bottom of the screen. */
  phone?: boolean;
};

/**
 * Trading an index (NSTOCK-0440). An index cannot be bought or sold, so its page says so and
 * trades the ETF that tracks it instead: the fund's live price, Buy and Sell that open the fund's
 * order ticket, and a link to the fund's own page. Nothing for an index with no fund.
 */
export function IndexEtfTrade({ index, phone = false }: IndexEtfTradeProps) {
  const headingId = useId();
  const openTicket = useOpenTicket();
  const fund = INDEX_ETFS[index.symbol];
  if (!fund) return null;
  const trade = (side: OrderSide) => {
    void openTicket({ symbol: fund.symbol, exchange: fund.exchange, side });
  };
  const price = (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <PriceCell symbol={fund.symbol} exchange={fund.exchange} size={phone ? 'sm' : 'md'} />
      <LiveChange symbol={fund.symbol} exchange={fund.exchange} percentOnly={phone} size="sm" />
    </div>
  );
  const fundLink = (
    <Link
      to="/stocks/$symbol"
      params={{ symbol: fund.symbol }}
      search={{ exchange: fund.exchange }}
      className="inline-flex min-h-6 items-center gap-0.5 rounded-sm font-semibold text-brand hover:underline focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
    >
      {phone ? fund.name : strings.indexEtf.view(fund.name)}
      <IconChevronRight aria-hidden="true" className="size-4" />
    </Link>
  );
  const buyButton = (
    <Button
      variant="buy"
      size="lg"
      aria-label={strings.indexEtf.buyLabel(fund.name)}
      onClick={() => trade('BUY')}
    >
      {strings.indexEtf.buy}
    </Button>
  );
  const sellButton = (
    <Button
      variant="sell"
      size="lg"
      aria-label={strings.indexEtf.sellLabel(fund.name)}
      onClick={() => trade('SELL')}
    >
      {strings.indexEtf.sell}
    </Button>
  );
  // Buy then Sell, as the stock header; on a phone Sell then Buy, as the stock page's bar (§9.4).
  const buttons = (
    <div
      role="group"
      aria-label={strings.indexEtf.tradeLabel(fund.name)}
      className={cn('grid grid-cols-2 gap-2', !phone && 'sm:w-64')}
    >
      {phone ? null : buyButton}
      {sellButton}
      {phone ? buyButton : null}
    </div>
  );

  if (phone) {
    // Sticky to the bottom, edge to edge, as the stock page's trade bar (§9.4): the actions stay
    // under the thumb, and the note above names the fund so the bar is never a surprise.
    return (
      <>
        <p className="text-label text-ink-muted" data-testid="index-etf-note">
          {strings.indexEtf.phoneNote(index.name, fund.name)}
        </p>
        <div
          data-testid="index-etf-bar"
          className="sticky bottom-0 z-(--nth-z-header) -mx-4 -mb-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
        >
          <div className="grid gap-2 px-4 py-3">
            <div className="flex min-w-0 items-center justify-between gap-3 text-label">
              {fundLink}
              {price}
            </div>
            {buttons}
          </div>
        </div>
      </>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="index-etf-card"
      className="grid gap-4 rounded-lg border border-line bg-surface p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-5"
    >
      <div className="grid min-w-0 gap-2">
        <h2 id={headingId} className="text-lg font-semibold text-ink">
          {strings.indexEtf.title(index.name)}
        </h2>
        <p className="max-w-prose text-body text-ink-muted">
          {strings.indexEtf.body(index.name, fund.name)}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body">
          {fundLink}
          {price}
        </div>
      </div>
      {buttons}
    </section>
  );
}

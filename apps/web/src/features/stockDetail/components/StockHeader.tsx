import type { Exchange, Instrument, OrderSide, Quote } from '@nthstock/contracts';
import { Button, SegmentedControl, cn } from '@nthstock/ui';
import { PriceAlertButton } from '@/features/notifications';
import { WatchlistStar } from '@/features/watchlist';
import { LiveChange } from '@/shared/components/LiveChange';
import { PriceCell } from '@/shared/components/PriceCell';
import { useOpenTicket } from '@/shared/hooks/useOpenTicket';
import { EXCHANGES, useExchangeListings } from '../hooks/useExchangeListings';
import { strings } from '../strings';

export type StockHeaderProps = {
  instrument: Instrument;
  /** REST snapshot shown until the first live quote arrives. */
  snapshot?: Quote | null | undefined;
  onExchangeChange: (exchange: Exchange) => void;
  /** The phone layout (T12): Buy and Sell move to the bottom bar, controls grow to 44 px. */
  phone?: boolean;
  /** A phone in landscape (SPEC-CR-1 §6.2): name, price, change and exchange on one line. */
  oneLine?: boolean;
};

/**
 * Stock detail header (T-106): name, symbol, NSE/BSE toggle, the live price (PriceCell) and day
 * change (LiveChange, ▲▼ with text), and Buy/Sell for equities. Buy and Sell open the order
 * ticket (T-135) through the ticket intent; a signed-out user goes through /login first.
 */
export function StockHeader({
  instrument,
  snapshot,
  onExchangeChange,
  phone = false,
  oneLine = false,
}: StockHeaderProps) {
  const { symbol, exchange, type } = instrument;
  const format = type === 'INDEX' ? 'index' : 'inr';
  const { listed, unlisted } = useExchangeListings(instrument);
  const openTicket = useOpenTicket();

  // The order ticket slide-over (T-135) opens from the intent; signed out, login comes first.
  const trade = (side: OrderSide) => {
    void openTicket({ symbol, exchange, side });
  };

  const exchangeControl = (
    <SegmentedControl
      label={strings.header.exchangeLabel}
      size={phone ? 'touch' : 'sm'}
      value={exchange}
      onValueChange={onExchangeChange}
      options={EXCHANGES.map((value) => ({
        value,
        label: value,
        disabled: !listed[value],
        ...(phone && !listed[value] ? { ariaLabel: strings.header.notListedOption(value) } : {}),
      }))}
    />
  );
  const price = (
    // On a phone the change sits under the price, loading or not, so the block never reflows.
    <div
      className={cn(
        'min-w-0',
        phone && !oneLine
          ? 'grid justify-items-start gap-1'
          : 'flex flex-wrap items-baseline gap-x-3 gap-y-1',
      )}
    >
      <span className="sr-only">{strings.header.priceLabel}</span>
      <PriceCell
        symbol={symbol}
        exchange={exchange}
        format={format}
        size="lg"
        initial={snapshot?.ltp}
      />
      <span className="sr-only">{strings.header.changeLabel}</span>
      <LiveChange
        symbol={symbol}
        exchange={exchange}
        format={format}
        soft
        size="md"
        initial={snapshot ? { change: snapshot.change, changeBp: snapshot.changeBp } : undefined}
      />
    </div>
  );

  if (phone && oneLine) {
    return (
      <div className="flex min-w-0 items-center gap-3" data-part="price-block">
        <div className="grid min-w-0 shrink">
          <h1 className="truncate text-lg font-semibold text-ink">{instrument.name}</h1>
          <p className="truncate font-mono text-label font-medium text-ink">{symbol}</p>
        </div>
        <div className="min-w-0 flex-1">{price}</div>
        <div className="shrink-0">{exchangeControl}</div>
        {type === 'EQUITY' ? (
          <div className="flex shrink-0">
            <PriceAlertButton symbol={symbol} exchange={exchange} />
            <WatchlistStar instrument={instrument} />
          </div>
        ) : null}
      </div>
    );
  }

  if (phone) {
    // The phone price block (SPEC-CR-1 §6.1, 72 to 110 px): no card chrome, the name and symbol
    // beside alert and watchlist, then the price and change beside the exchange. An exchange the
    // stock is not listed on is a disabled segment named "BSE, not listed"; the symbol line says
    // "NSE only" so the reason is visible too.
    return (
      <div className="grid gap-2" data-part="price-block">
        <div className="flex items-center gap-2">
          <div className="grid min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-ink">{instrument.name}</h1>
            <p className="truncate text-label text-ink-muted">
              <span className="font-mono font-medium text-ink">{symbol}</span>
              {` · ${strings.instrumentType[type]}`}
              {instrument.sector ? ` · ${instrument.sector}` : null}
              {unlisted.length > 0 ? ` · ${strings.header.listedOnly(exchange)}` : null}
            </p>
          </div>
          {type === 'EQUITY' ? (
            <div className="flex shrink-0">
              <PriceAlertButton symbol={symbol} exchange={exchange} />
              <WatchlistStar instrument={instrument} />
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3">
          {price}
          <div className="shrink-0">{exchangeControl}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:p-5">
      <div className="grid min-w-0 gap-3">
        <div className="grid gap-1">
          <div className="flex items-start gap-3">
            <h1 className="text-title min-w-0 flex-1 break-words text-ink">{instrument.name}</h1>
            {type === 'EQUITY' ? (
              <div className="flex shrink-0 gap-2">
                <PriceAlertButton symbol={symbol} exchange={exchange} />
                <WatchlistStar instrument={instrument} />
              </div>
            ) : null}
          </div>
          <p className="flex flex-wrap items-center gap-2 text-body text-ink-muted">
            <span className="font-mono font-medium text-ink">{symbol}</span>
            <span aria-hidden="true">·</span>
            <span>{strings.instrumentType[type]}</span>
            {instrument.sector ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{instrument.sector}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {exchangeControl}
          {unlisted.map((option) => (
            <span key={option} className="text-label text-ink-muted">
              {strings.header.notListed(symbol, option)}
            </span>
          ))}
        </div>
        {price}
      </div>
      {type === 'EQUITY' ? (
        <div className="grid gap-2">
          <div
            role="group"
            aria-label={strings.header.tradeLabel(symbol)}
            className="grid grid-cols-2 gap-2 sm:w-64"
          >
            <Button
              variant="buy"
              size="lg"
              aria-label={strings.header.buyLabel(symbol)}
              onClick={() => trade('BUY')}
            >
              {strings.header.buy}
            </Button>
            <Button
              variant="sell"
              size="lg"
              aria-label={strings.header.sellLabel(symbol)}
              onClick={() => trade('SELL')}
            >
              {strings.header.sell}
            </Button>
          </div>
          <p className="text-label text-ink-muted">{strings.header.paperNote}</p>
        </div>
      ) : null}
    </div>
  );
}

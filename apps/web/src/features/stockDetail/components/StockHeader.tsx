import type { Exchange, Instrument, OrderSide, Quote } from '@nthstock/contracts';
import { Button, SegmentedControl, useToast } from '@nthstock/ui';
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
};

/**
 * Stock detail header (T-106): name, symbol, NSE/BSE toggle, the live price (PriceCell) and day
 * change (LiveChange, ▲▼ with text), and Buy/Sell for equities. Buy and Sell record the ticket
 * intent; a signed-out user goes through /login first.
 */
export function StockHeader({ instrument, snapshot, onExchangeChange }: StockHeaderProps) {
  const { symbol, exchange, type } = instrument;
  const format = type === 'INDEX' ? 'index' : 'inr';
  const { listed, unlisted } = useExchangeListings(instrument);
  const openTicket = useOpenTicket();
  const toast = useToast();

  const trade = async (side: OrderSide) => {
    const result = await openTicket({ symbol, exchange, side });
    if (result === 'opened') {
      const label = side === 'BUY' ? strings.header.buy : strings.header.sell;
      toast.show({
        title: strings.header.ticketSoon.title(label, symbol),
        description: strings.header.ticketSoon.body,
      });
    }
  };

  return (
    <header className="grid gap-4 rounded-lg border border-line bg-surface p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:p-5">
      <div className="grid min-w-0 gap-3">
        <div className="grid gap-1">
          <h1 className="text-title break-words text-ink">{instrument.name}</h1>
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
          <SegmentedControl
            label={strings.header.exchangeLabel}
            size="sm"
            value={exchange}
            onValueChange={onExchangeChange}
            options={EXCHANGES.map((value) => ({
              value,
              label: value,
              disabled: !listed[value],
            }))}
          />
          {unlisted.map((option) => (
            <span key={option} className="text-label text-ink-muted">
              {strings.header.notListed(symbol, option)}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
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
            initial={
              snapshot ? { change: snapshot.change, changeBp: snapshot.changeBp } : undefined
            }
          />
        </div>
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
              onClick={() => void trade('BUY')}
            >
              {strings.header.buy}
            </Button>
            <Button
              variant="sell"
              size="lg"
              aria-label={strings.header.sellLabel(symbol)}
              onClick={() => void trade('SELL')}
            >
              {strings.header.sell}
            </Button>
          </div>
          <p className="text-label text-ink-muted">{strings.header.paperNote}</p>
        </div>
      ) : null}
    </header>
  );
}

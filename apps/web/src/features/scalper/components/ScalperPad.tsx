import { isApiError } from '@nthstock/apiClient';
import type { Instrument, Order, OrderSide } from '@nthstock/contracts';
import { cn, useToast } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useId, useState } from 'react';
import { useFocusedDepth } from '@/shared/hooks/useFocusedDepth';
import { claimFillToast, fillEventKey } from '@/shared/lib/fillToasts';
import { useScalpOrder } from '../hooks/useScalpOrder';
import {
  QTY_PRESETS,
  ackFor,
  newScalpOrderId,
  parseQty,
  scalpRequest,
  sendingAck,
  touchPrices,
  type Ack,
} from '../model/scalpOrder';
import { useScalperPrefs } from '../model/scalperPrefs';
import { strings } from '../strings';

export type ScalperPadProps = { instrument: Instrument };

const TARGET = 'min-h-11 min-w-11';

/**
 * The scalper pad (T21, SPEC-TFC-1 §11): quantity chips with the size remembered on the device,
 * an Arm switch, and Sell at bid and Buy at ask, each one tap while armed. A button sends an
 * intraday IOC limit at the price it shows, taken from the depth in the same frame, so nothing is
 * left resting. Every answer shows as an acknowledgement chip and a toast. While disarmed the
 * buttons say "Arm to trade" and send nothing. No depth ladder (REQ-SCP-01).
 */
export function ScalperPad({ instrument }: ScalperPadProps) {
  const { symbol, exchange, token } = instrument;
  const depth = useFocusedDepth(symbol, exchange);
  const { bid, ask } = touchPrices(depth);
  const qty = useScalperPrefs((s) => s.qty);
  const customQty = useScalperPrefs((s) => s.customQty);
  const pick = useScalperPrefs((s) => s.pick);
  const pickCustom = useScalperPrefs((s) => s.pickCustom);
  const [custom, setCustom] = useState(customQty === null ? '' : String(customQty));
  const [armed, setArmed] = useState(false);
  const [ack, setAck] = useState<Ack | null>(null);
  const armDescription = useId();
  const customSelected =
    customQty !== null && qty === customQty && !(QTY_PRESETS as readonly number[]).includes(qty);
  const send = useScalpOrder();
  const toast = useToast();

  const report = (order: Order) => {
    const next = ackFor(order);
    setAck(next);
    const price = order.avgFillPrice === null ? '' : formatInr(order.avgFillPrice);
    const description = strings.toast.description(order.side, order.filledQty, symbol, price);
    if (next.tone === 'filled' || next.tone === 'partial') {
      if (!claimFillToast(fillEventKey(order))) return;
      const title = next.tone === 'filled' ? strings.toast.filled : strings.toast.partial;
      toast.show({ title, description, tone: 'success' });
    } else {
      const title = next.tone === 'rejected' ? strings.toast.rejected : strings.toast.unfilled;
      toast.show({
        title,
        description: next.text,
        tone: next.tone === 'rejected' ? 'error' : 'info',
      });
    }
  };

  const trade = (side: OrderSide) => {
    const price = side === 'BUY' ? ask : bid;
    if (!armed || price === null) return;
    setAck(sendingAck(side, qty));
    send(scalpRequest(side, qty, price, token, newScalpOrderId()))
      .then(report)
      .catch((error: unknown) => {
        const refused = isApiError(error) && error.kind !== 'network' && error.status < 500;
        const text = refused ? strings.ack.rejected(error.message) : strings.ack.failed;
        setAck({ tone: 'rejected', text });
        toast.show({ title: strings.toast.rejected, description: text, tone: 'error' });
      });
  };

  const onCustom = (text: string) => {
    setCustom(text);
    const parsed = parseQty(text);
    if (parsed !== null) pickCustom(parsed);
  };

  return (
    <section
      aria-label={strings.pad(symbol)}
      data-testid="scalper-pad"
      className="grid gap-2 px-4 py-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div role="radiogroup" aria-label={strings.qty.label} className="flex flex-wrap gap-1.5">
          {QTY_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={qty === preset}
              aria-label={strings.qty.preset(preset)}
              onClick={() => pick(preset)}
              className={cn(
                TARGET,
                'rounded-md border px-2 font-mono text-body font-semibold tabular-nums',
                qty === preset
                  ? 'border-brand bg-brand text-surface'
                  : 'border-line bg-surface text-ink',
              )}
            >
              {preset}
            </button>
          ))}
          <input
            type="text"
            inputMode="numeric"
            aria-label={strings.qty.custom}
            placeholder={strings.qty.customHint}
            value={custom}
            onChange={(event) => onCustom(event.target.value)}
            onFocus={() => {
              const parsed = parseQty(custom);
              if (parsed !== null) pickCustom(parsed);
            }}
            data-selected={customSelected}
            className={cn(
              TARGET,
              'w-20 rounded-md border px-2 text-center font-mono text-body font-semibold tabular-nums',
              'data-[selected=true]:border-brand data-[selected=true]:ring-1 data-[selected=true]:ring-brand',
              'border-line bg-surface text-ink placeholder:font-sans placeholder:text-label placeholder:font-normal',
            )}
          />
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={armed}
          aria-describedby={armDescription}
          onClick={() => setArmed((on) => !on)}
          className={cn(
            TARGET,
            'flex items-center gap-2 rounded-pill border px-3 text-body font-semibold',
            armed ? 'border-down bg-down text-surface' : 'border-line bg-surface text-ink',
          )}
        >
          <span
            aria-hidden="true"
            className={cn('size-2.5 rounded-pill', armed ? 'bg-surface' : 'bg-ink-muted')}
          />
          {strings.arm.label}
        </button>
        <span id={armDescription} hidden>
          {strings.arm.description}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PadButton
          side="SELL"
          armed={armed}
          price={bid}
          qty={qty}
          symbol={symbol}
          onTrade={trade}
        />
        <PadButton side="BUY" armed={armed} price={ask} qty={qty} symbol={symbol} onTrade={trade} />
      </div>

      <p
        role="status"
        aria-label={strings.ack.label}
        data-testid="scalp-ack"
        data-tone={ack?.tone ?? 'none'}
        className={cn(
          'min-h-6 text-center text-label font-medium',
          ack?.tone === 'rejected' || ack?.tone === 'unfilled' ? 'text-down' : 'text-ink',
        )}
      >
        {ack?.text ?? ''}
      </p>
    </section>
  );
}

function PadButton({
  side,
  armed,
  price,
  qty,
  symbol,
  onTrade,
}: {
  side: OrderSide;
  armed: boolean;
  price: number | null;
  qty: number;
  symbol: string;
  onTrade: (side: OrderSide) => void;
}) {
  const describedBy = useId();
  const buy = side === 'BUY';
  const ready = armed && price !== null;
  // The name is what the button shows (WCAG 2.5.3); the size and IOC are its description.
  const second = !armed ? strings.armToTrade : price === null ? strings.waiting : formatInr(price);
  return (
    <button
      type="button"
      aria-disabled={!ready}
      aria-describedby={describedBy}
      data-testid={buy ? 'scalp-buy' : 'scalp-sell'}
      onClick={() => onTrade(side)}
      className={cn(
        'grid min-h-14 content-center gap-0.5 rounded-md px-3 text-center font-semibold',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
        ready
          ? buy
            ? 'bg-brand text-surface'
            : 'bg-down text-surface'
          : 'border border-dashed border-line bg-canvas text-ink-muted',
      )}
    >
      <span className="text-body">{buy ? strings.buy.label : strings.sell.label}</span>{' '}
      <span className="font-mono text-label tabular-nums">{second}</span>
      <span id={describedBy} hidden>
        {strings.orderDescription(side, qty, symbol)}
      </span>
    </button>
  );
}

import { isApiError, type TradingState } from '@nthstock/apiClient';
import type { Instrument, Order, OrderSide } from '@nthstock/contracts';
import { cn, useToast } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useFocusedDepth } from '@/shared/hooks/useFocusedDepth';
import { useTradingSelector } from '@/shared/hooks/useTradingSelector';
import { claimFillToast, fillEventKey } from '@/shared/lib/fillToasts';
import { useArming, type DisarmReason } from '../hooks/useArming';
import { useClosePosition } from '../hooks/useClosePosition';
import { useScalpOrder } from '../hooks/useScalpOrder';
import {
  QTY_PRESETS,
  ackFor,
  closeAck,
  newScalpOrderId,
  parseQty,
  reverseAck,
  scalpRequest,
  sendingAck,
  touchPrices,
  type Ack,
} from '../model/scalpOrder';
import { useScalperPrefs } from '../model/scalperPrefs';
import { strings } from '../strings';
import { HoldButton } from './HoldButton';

export type ScalperPadProps = { instrument: Instrument };

const TARGET = 'min-h-11 min-w-11';
const ACTION = cn(
  'grid min-h-12 content-center gap-0.5 rounded-md border px-3 text-center font-semibold',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
);

type Busy = 'close' | 'reverse' | null;

/**
 * The scalper pad (T21, T22, SPEC-TFC-1 §11): quantity chips with the size remembered on the
 * device, an Arm switch, Sell at bid and Buy at ask, Flatten and Reverse. A trade button sends an
 * intraday IOC limit at the price it shows, taken from the depth in the same frame, so nothing is
 * left resting. Flatten closes the intraday position in one tap; Reverse closes it and opens the
 * same size the other way, and needs a 400 ms hold because it doubles exposure. Every answer
 * shows as an acknowledgement chip and a toast. While disarmed the buttons say "Arm to trade" and
 * send nothing; the pad disarms itself after two idle minutes, when the page is hidden and when
 * the instrument changes (§11.3). No depth ladder (REQ-SCP-01).
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
  const [ack, setAck] = useState<Ack | null>(null);
  const onDisarm = useCallback((reason: DisarmReason) => {
    setAck({ tone: 'info', text: reason === 'idle' ? strings.arm.idle : strings.arm.hidden });
  }, []);
  const { armed, setArmed, noteTrade } = useArming(token, onDisarm);
  const busy = useRef<Busy>(null);
  // The touch when an answer lands: Reverse enters at the price on screen then, not at the tap.
  const touch = useRef({ bid, ask });
  useEffect(() => {
    touch.current = { bid, ask };
  }, [bid, ask]);
  const selectNetQty = useCallback(
    (state: TradingState) =>
      state.positions.find(
        (position) => position.token === token && position.product === 'INTRADAY',
      )?.netQty ?? 0,
    [token],
  );
  const netQty = useTradingSelector(selectNetQty);
  const armDescription = useId();
  const flattenDescription = useId();
  const reverseDescription = useId();
  const customSelected =
    customQty !== null && qty === customQty && !(QTY_PRESETS as readonly number[]).includes(qty);
  const send = useScalpOrder();
  const close = useClosePosition();
  const toast = useToast();

  const report = (order: Order, next: Ack = ackFor(order), closing = false) => {
    setAck(next);
    const price = order.avgFillPrice === null ? '' : formatInr(order.avgFillPrice);
    const description = strings.toast.description(order.side, order.filledQty, symbol, price);
    if (next.tone === 'filled' || next.tone === 'partial') {
      if (!claimFillToast(fillEventKey(order))) return;
      const title = closing
        ? next.tone === 'filled'
          ? strings.toast.closed
          : strings.toast.partlyClosed
        : next.tone === 'filled'
          ? strings.toast.filled
          : strings.toast.partial;
      toast.show({ title, description: closing ? next.text : description, tone: 'success' });
    } else {
      const title = next.tone === 'rejected' ? strings.toast.rejected : strings.toast.unfilled;
      toast.show({
        title,
        description: next.text,
        tone: next.tone === 'rejected' ? 'error' : 'info',
      });
    }
  };

  const failed = (error: unknown) => {
    const refused = isApiError(error) && error.kind !== 'network' && error.status < 500;
    const text = refused ? strings.ack.rejected(error.message) : strings.ack.failed;
    setAck({ tone: 'rejected', text });
    toast.show({ title: strings.toast.rejected, description: text, tone: 'error' });
  };

  const trade = (side: OrderSide) => {
    const price = side === 'BUY' ? ask : bid;
    if (!armed || price === null || busy.current !== null) return;
    noteTrade();
    setAck(sendingAck(side, qty));
    send(scalpRequest(side, qty, price, token, newScalpOrderId()))
      .then((order) => report(order))
      .catch(failed);
  };

  const flatten = () => {
    if (!armed || netQty === 0 || busy.current !== null) return;
    busy.current = 'close';
    noteTrade();
    setAck({ tone: 'sending', text: strings.ack.closing });
    close(token)
      .then((exit) => report(exit, closeAck(exit), true))
      .catch(failed)
      .finally(() => {
        busy.current = null;
      });
  };

  // Close, then the same size the other way at the touch; a part close stops there (§11.2).
  const reverse = async () => {
    if (!armed || netQty === 0 || busy.current !== null) return;
    busy.current = 'reverse';
    noteTrade();
    setAck({ tone: 'sending', text: strings.ack.reversing });
    try {
      const exit = await close(token);
      const closed = closeAck(exit);
      if (closed.tone !== 'filled') {
        report(exit, closed, true);
        return;
      }
      const price = exit.side === 'BUY' ? touch.current.ask : touch.current.bid;
      if (price === null) {
        report(exit, closed, true);
        return;
      }
      const entry = await send(
        scalpRequest(exit.side, exit.filledQty, price, token, newScalpOrderId()),
      );
      report(entry, reverseAck(entry));
    } catch (error) {
      failed(error);
    } finally {
      busy.current = null;
    }
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
          onClick={() => setArmed(!armed)}
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

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-disabled={!armed || netQty === 0}
          aria-describedby={flattenDescription}
          data-testid="scalp-flatten"
          onClick={flatten}
          className={cn(
            ACTION,
            armed && netQty !== 0
              ? 'border-ink bg-surface text-ink'
              : 'border-dashed border-line bg-canvas text-ink-muted',
          )}
        >
          <span className="text-body">{strings.flatten.label}</span>{' '}
          <span className="font-mono text-label tabular-nums">
            {!armed
              ? strings.armToTrade
              : netQty === 0
                ? strings.flatten.flat
                : strings.flatten.exit(netQty > 0 ? 'SELL' : 'BUY', Math.abs(netQty))}
          </span>
          <span id={flattenDescription} hidden>
            {strings.flatten.description(symbol)}
          </span>
        </button>
        <HoldButton
          ready={armed && netQty !== 0}
          onHold={() => void reverse()}
          describedBy={reverseDescription}
          testId="scalp-reverse"
          className={cn(
            ACTION,
            armed && netQty !== 0
              ? 'border-ink bg-surface text-ink'
              : 'border-dashed border-line bg-canvas text-ink-muted',
          )}
        >
          <span className="text-body">{strings.reverse.label}</span>{' '}
          <span className="text-label">
            {!armed
              ? strings.armToTrade
              : netQty === 0
                ? strings.flatten.flat
                : strings.reverse.hold}
          </span>
          <span id={reverseDescription} hidden>
            {strings.reverse.description(symbol)}
          </span>
        </HoldButton>
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

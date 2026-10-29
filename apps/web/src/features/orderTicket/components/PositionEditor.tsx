import type { TradingState } from '@nthstock/apiClient';
import type { Order, Position } from '@nthstock/contracts';
import {
  Button,
  ErrorState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCancelOrder } from '@/features/orders';
import { livePosition } from '@/features/positions';
import { PnlAmount } from '@/shared/components/PnlAmount';
import { useQuote } from '@/shared/hooks/useQuote';
import { usePositionTrailingStop } from '@/shared/hooks/useTrailingStops';
import { useTradingSelector } from '@/shared/hooks/useTradingSelector';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';
import type { PositionEditorTab, PositionEditorTarget } from '@/shared/lib/positionEditorStore';
import { useTicketIntentStore, type TicketIntent } from '@/shared/lib/ticketIntentStore';
import { trailingStopSummary } from '@/shared/lib/trailingStopView';
import { orderCue } from '@/shared/motion/orderCues';
import { isActiveStop } from '../model/trailingSheet';
import { strings } from '../strings';
import { OrderTicket } from './OrderTicket';
import { TicketSkeleton } from './TicketSkeleton';
import { TrailingStopSheet } from './TrailingStopSheet';

export type PositionEditorProps = {
  target: PositionEditorTarget;
  onClose: () => void;
};

const OPEN_STATUSES: ReadonlySet<string> = new Set(['OPEN', 'AMO']);
const tradingStatus = (state: TradingState) => state.status;

const samePosition = (a: Position | null, b: Position | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.netQty === b.netQty &&
    a.avgBuyPrice === b.avgBuyPrice &&
    a.avgSellPrice === b.avgSellPrice &&
    a.realisedPnl === b.realisedPnl);

const sameOrders = (a: readonly Order[], b: readonly Order[]) =>
  a.length === b.length &&
  a.every(
    (order, i) =>
      order.id === b[i]?.id &&
      order.status === b[i].status &&
      order.filledQty === b[i].filledQty &&
      order.qty === b[i].qty,
  );

/**
 * The position editor (NSTOCK-0395), opened by Edit on a Positions row or "Edit stop" on an
 * order. It states what is actually held (the executed quantity, average price and live P&L),
 * the open orders in the stock with how much of each has filled, and the trailing stop, then
 * offers every change in one place: the trailing stop with all its terms, an exit of all or part
 * of the executed quantity through the full order ticket (market or limit, review first), and
 * adding to the position. Nothing is sent until a button is tapped.
 */
export function PositionEditor({ target, onClose }: PositionEditorProps) {
  const selectPosition = useCallback(
    (state: TradingState) =>
      state.positions.find(
        (position) =>
          position.token === target.token &&
          position.product === target.product &&
          position.netQty !== 0,
      ) ?? null,
    [target.token, target.product],
  );
  const position = useTradingSelector(selectPosition, samePosition);
  const status = useTradingSelector(tradingStatus);
  const store = useTradingStore();
  // A position that closes while the editor is open (a full exit whose fill lands before its
  // REST answer, or the stop firing) closes the editor; the fill has its own toast (T-147).
  const wasHeld = useRef(false);
  useEffect(() => {
    if (position) wasHeld.current = true;
    else if (wasHeld.current) onClose();
  }, [position, onClose]);
  const [tab, setTab] = useState<PositionEditorTab>(target.tab ?? 'stop');
  // Until the account state has loaded, "closed" would be a guess: wait, or say it failed.
  if (!position && (status === 'idle' || status === 'loading')) return <TicketSkeleton />;
  if (!position && status === 'error') {
    return (
      <ErrorState
        title={strings.editor.loadError}
        description={strings.loadError.body}
        retryLabel={strings.loadError.retry}
        onRetry={() => void store.start()}
      />
    );
  }
  if (!position) {
    return (
      <p className="p-4 text-body text-ink" role="status">
        {strings.editor.noPosition}
      </p>
    );
  }
  const exitSide = position.netQty > 0 ? 'SELL' : 'BUY';
  const held = Math.abs(position.netQty);
  const exit: TicketIntent = {
    symbol: target.symbol,
    exchange: target.exchange,
    side: exitSide,
    qty: held,
    product: position.product,
    maxQty: held,
  };
  const add: TicketIntent = {
    symbol: target.symbol,
    exchange: target.exchange,
    side: exitSide === 'SELL' ? 'BUY' : 'SELL',
    product: position.product,
  };
  return (
    <div className="grid">
      <Summary target={target} position={position} onClose={onClose} />
      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as PositionEditorTab)}
        className="grid"
      >
        <TabsList aria-label={strings.editor.tabs} className="px-4">
          <TabsTrigger value="stop">{strings.editor.tabStop}</TabsTrigger>
          <TabsTrigger value="exit">{strings.editor.tabExit}</TabsTrigger>
          <TabsTrigger value="add">{strings.editor.tabAdd}</TabsTrigger>
        </TabsList>
        <TabsContent value="stop" className="pt-0">
          <TrailingStopSheet target={target} onClose={onClose} full />
        </TabsContent>
        <TabsContent value="exit" className="pt-0">
          {/* Re-keyed on the held quantity, so a fill while open refreshes the prefill and cap. */}
          <OrderTicket key={`exit:${String(held)}`} intent={exit} onClose={onClose} />
        </TabsContent>
        <TabsContent value="add" className="pt-0">
          <OrderTicket key={`add:${String(held)}`} intent={add} onClose={onClose} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Summary({
  target,
  position,
  onClose,
}: {
  target: PositionEditorTarget;
  position: Position;
  onClose: () => void;
}) {
  const ltp = useQuote(target.symbol, target.exchange)?.quote.ltp ?? position.ltp;
  const live = livePosition(position, ltp ?? undefined);
  const stop = usePositionTrailingStop(position.token, position.product);
  const active = isActiveStop(stop) ? stop : null;
  const selectOrders = useCallback(
    (state: TradingState) =>
      state.orders.filter(
        (order) => order.token === target.token && OPEN_STATUSES.has(order.status),
      ),
    [target.token],
  );
  const orders = useTradingSelector(selectOrders, sameOrders);
  const qty = position.netQty > 0 ? `+${String(position.netQty)}` : String(position.netQty);
  return (
    <div className="grid gap-3 p-4" data-testid="editor-summary">
      <dl className="grid grid-cols-3 gap-3 rounded-md bg-canvas p-3">
        <div className="grid gap-0.5">
          <dt className="text-label text-ink-muted">{strings.editor.held}</dt>
          <dd className="font-mono text-body font-semibold text-ink tabular-nums">{qty}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-label text-ink-muted">{strings.editor.avg}</dt>
          <dd className="font-mono text-body text-ink tabular-nums">
            {live.avgPrice === null ? '–' : formatInr(live.avgPrice)}
          </dd>
        </div>
        <div className="grid gap-0.5 text-right">
          <dt className="text-label text-ink-muted">{strings.editor.pnl}</dt>
          <dd data-testid="editor-pnl">
            <PnlAmount value={live.pnl} size="md" />
          </dd>
        </div>
        <div className="col-span-3 grid gap-0.5">
          <dt className="text-label text-ink-muted">{strings.editor.stop}</dt>
          <dd className="text-body font-medium text-ink" data-testid="editor-stop">
            {active
              ? `${trailingStopSummary(active)} · ${strings.editor.protects(active.protectedQty)}`
              : strings.sheet.none}
          </dd>
        </div>
      </dl>
      {orders.length > 0 ? (
        <section className="grid gap-2" aria-label={strings.editor.openOrders}>
          <h3 className="text-label font-semibold text-ink-muted">{strings.editor.openOrders}</h3>
          <ul className="grid gap-2">
            {orders.map((order) => (
              <OpenOrderLine key={order.id} order={order} onClose={onClose} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function OpenOrderLine({ order, onClose }: { order: Order; onClose: () => void }) {
  const toast = useToast();
  const openTicket = useTicketIntentStore((s) => s.openTicket);
  const cancel = useCancelOrder();
  const [confirming, setConfirming] = useState(false);
  const line = strings.editor.orderLine(
    strings.sides[order.side],
    order.type === 'LIMIT' && order.price !== null
      ? `${strings.types.LIMIT} ${formatInr(order.price)}`
      : strings.types[order.type],
    order.filledQty,
    order.qty,
  );
  const onCancel = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    cancel.mutate(order.id, {
      onSuccess: () => {
        orderCue('cancelled');
        toast.show({ title: strings.editor.cancelled, tone: 'success' });
      },
      onError: () => {
        orderCue('rejected');
        setConfirming(false);
        toast.show({ title: strings.editor.cancelFailed, tone: 'error' });
      },
    });
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2">
      <span className="font-mono text-label text-ink tabular-nums">{line}</span>
      <span className="flex gap-1">
        {/* Always mounted, so screen readers hear the text when it appears. */}
        <span className="sr-only" role="status">
          {confirming ? strings.editor.confirmCancelHint : ''}
        </span>
        <Button
          size="sm"
          variant="secondary"
          aria-label={strings.editor.modifyLabel(line)}
          onClick={() => {
            onClose();
            openTicket({
              symbol: order.symbol,
              exchange: order.exchange,
              side: order.side,
              modify: order,
            });
          }}
        >
          {strings.editor.modify}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label={
            confirming ? strings.editor.confirmCancelLabel(line) : strings.editor.cancelLabel(line)
          }
          loading={cancel.isPending}
          onClick={onCancel}
          onBlur={() => {
            if (!cancel.isPending) setConfirming(false);
          }}
        >
          {confirming ? strings.editor.confirmCancel : strings.editor.cancel}
        </Button>
      </span>
    </li>
  );
}

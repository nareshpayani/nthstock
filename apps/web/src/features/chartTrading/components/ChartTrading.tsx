import type { Instrument, Order, OrderSide } from '@nthstock/contracts';
import { useToast } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useEffect, useRef, useState } from 'react';
import type { ChartHandle } from '@/features/charts';
import { useOpenTicket } from '@/shared/hooks/useOpenTicket';
import { usePendingOrderPrices } from '@/shared/hooks/usePendingOrderPrices';
import { useOrderDraftStore } from '@/shared/lib/orderDraftStore';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';
import { useChartOrders } from '../hooks/useChartOrders';
import { actionErrorText, useOrderLineActions } from '../hooks/useOrderLineActions';
import { CANCEL_ACTION, orderLine } from '../model/orderLines';
import type { OverlayLine } from '../model/overlayLine';
import { strings } from '../strings';
import { ChartOverlay } from './ChartOverlay';

export type ChartTradingProps = {
  handle: ChartHandle;
  instrument: Pick<Instrument, 'symbol' | 'exchange' | 'tickSize' | 'token'>;
};

const GHOST = 'ghost';
/** A first tap on × arms "Cancel?" for this long (§8.3). */
export const CANCEL_ARM_MS = 3_000;

/**
 * Trading on the instrument chart (SPEC-TFC-1 §8). Working limit orders are lines (T16): drag one
 * and its price follows the finger on every surface, with one modify on release; tap × twice to
 * cancel. A fill or cancel during the drag ends it, puts the line back and says why. Tap the
 * price gutter for a ghost line at that price (T15), drag it to adjust, then tap Buy or Sell for
 * the compact ticket at that price (T17, §8.2); nothing is sent until Place.
 */
export function ChartTrading({ handle, instrument }: ChartTradingProps) {
  const toast = useToast();
  const store = useTradingStore();
  const actions = useOrderLineActions();
  const orders = useChartOrders(instrument.token);
  const pending = usePendingOrderPrices();
  const setDraft = useOrderDraftStore((state) => state.setDraft);
  const openTicket = useOpenTicket();
  const [ghost, setGhost] = useState<number | null>(null);
  const [ghostDrag, setGhostDrag] = useState<number | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Leaving the chart mid-drag must not leave a moving price on the other surfaces.
  useEffect(() => () => setDraft(null), [setDraft]);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  const lines: OverlayLine[] = orders.map((order) =>
    orderLine(order, pending.get(order.id), armed === order.id),
  );
  if (ghost !== null) {
    const price = ghostDrag ?? ghost;
    lines.push({
      id: GHOST,
      price,
      tone: 'ghost',
      label: strings.ghost.label(formatInr(price)),
      description: strings.ghost.description(formatInr(price)),
      draggable: true,
      actions: [
        {
          id: 'BUY',
          label: strings.ghost.buy,
          description: strings.ghost.buyDescription(formatInr(price)),
          look: 'buy',
        },
        {
          id: 'SELL',
          label: strings.ghost.sell,
          description: strings.ghost.sellDescription(formatInr(price)),
          look: 'sell',
        },
      ],
    });
  }

  const orderById = (id: string) => orders.find((order) => order.id === id);
  const describe = (order: Order, price: number) =>
    [strings.order.sides[order.side], order.qty - order.filledQty, formatInr(price)] as const;

  // The order moved on (filled or cancelled) before the change was sent: say so (§8.3).
  const announceGone = (id: string) => {
    const latest = store.getState().orders.find((order) => order.id === id);
    if (!latest) return;
    const filled = latest.status === 'EXECUTED';
    toast.show({
      title: strings.order.goneTitle,
      description: filled
        ? strings.order.filledFirst(formatInr(latest.avgFillPrice ?? latest.price ?? 0))
        : strings.order.cancelledFirst,
      tone: 'info',
    });
  };

  const modify = (order: Order, price: number) => {
    actions.modify(order, price).then(
      (modified) =>
        toast.show({
          title: strings.order.modified,
          description: strings.order.modifiedBody(...describe(modified, modified.price ?? price)),
          tone: 'success',
        }),
      (error: unknown) =>
        toast.show({
          title: strings.order.modifyFailed,
          description: actionErrorText(error),
          tone: 'error',
        }),
    );
  };

  const cancel = (order: Order) => {
    actions.cancel(order).then(
      (cancelled) =>
        toast.show({
          title: strings.order.cancelled,
          description: strings.order.cancelledBody(...describe(order, cancelled.price ?? 0)),
          tone: 'success',
        }),
      (error: unknown) =>
        toast.show({
          title: strings.order.cancelFailed,
          description: actionErrorText(error),
          tone: 'error',
        }),
    );
  };

  // Buy or Sell on the ghost: the compact ticket, a limit at the ghost's price (§8.2).
  const placeFromGhost = (side: OrderSide) => {
    if (ghost === null) return;
    const price = ghost;
    setGhost(null);
    setGhostDrag(null);
    void openTicket({
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      side,
      price,
      compact: true,
    });
  };

  const onAction = (id: string, action: string) => {
    if (id === GHOST) {
      if (action === 'BUY' || action === 'SELL') placeFromGhost(action);
      return;
    }
    const order = orderById(id);
    if (!order || action !== CANCEL_ACTION) return;
    if (armTimer.current) clearTimeout(armTimer.current);
    if (armed === id) {
      setArmed(null);
      cancel(order);
      return;
    }
    setArmed(id);
    armTimer.current = setTimeout(() => setArmed(null), CANCEL_ARM_MS);
  };

  return (
    <ChartOverlay
      handle={handle}
      lines={lines}
      tickSize={instrument.tickSize}
      label={strings.group(instrument.symbol)}
      onGutterTap={(price) => {
        setGhostDrag(null);
        setGhost(price);
      }}
      onDragMove={(id, price) => {
        if (id === GHOST) setGhostDrag(price);
        else setDraft({ orderId: id, price });
      }}
      onDragEnd={(id, price) => {
        if (id === GHOST) {
          setGhostDrag(null);
          if (price !== null) setGhost(price);
          return;
        }
        setDraft(null);
        const order = orderById(id);
        if (!order) {
          announceGone(id);
          return;
        }
        if (price !== null && price !== order.price) modify(order, price);
      }}
      onHandleDelete={(id) => {
        if (id === GHOST) {
          setGhost(null);
          return;
        }
        const order = orderById(id);
        if (order) cancel(order);
      }}
      onAction={onAction}
    />
  );
}

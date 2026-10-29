import type { TradingState } from '@nthstock/apiClient';
import type {
  Instrument,
  ModifyOrderRequest,
  Order,
  PlaceOrderRequest,
  TrailingStop,
} from '@nthstock/contracts';
import { ErrorState, useToast } from '@nthstock/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useContext, useEffect, useState, type MouseEvent } from 'react';
import { TERMINAL_TRAILING_STOP_STATUSES } from '@nthstock/contracts';
import { SegmentedControl } from '@nthstock/ui';
import { positionsQuery } from '@/features/positions';
import { useTradingSelector } from '@/shared/hooks/useTradingSelector';
import { useForm, useWatch } from 'react-hook-form';
import { fundsSummaryQuery } from '@/features/funds';
import { LiveChange } from '@/shared/components/LiveChange';
import { PriceCell } from '@/shared/components/PriceCell';
import { useMarketOpen } from '@/shared/hooks/useMarketOpen';
import { useQuote } from '@/shared/hooks/useQuote';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { claimFillToast } from '@/shared/lib/fillToasts';
import { fillCue, orderCue, useSuccessHold } from '@/shared/motion/orderCues';
import { MarketSessionContext } from '@/shared/lib/marketSessionContext';
import { useQuoteStore } from '@/shared/lib/quoteStoreContext';
import type { TicketIntent } from '@/shared/lib/ticketIntentStore';
import { ticketInstrumentQuery, ticketQuoteQuery, ticketStatsQuery } from '../api/ticketQueries';
import { useModifyOrder } from '../hooks/useModifyOrder';
import { usePlaceOrder } from '../hooks/usePlaceOrder';
import { amoDate as amoDateFor } from '../model/amo';
import { describeOrderError, type TicketError } from '../model/orderError';
import { modifiedToast, successToast } from '../model/orderToast';
import { preCheckOrder } from '../model/preCheck';
import {
  TicketFormSchema,
  defaultTicketValues,
  newClientOrderId,
  orderValue,
  ticketValuesFromOrder,
  toModifyRequest,
  toPlaceOrderRequest,
  type TicketFormValues,
} from '../model/ticketForm';
import { strings } from '../strings';
import { ReviewStep } from './ReviewStep';
import { TRAILING_SL, TicketForm, orderTypeOptions } from './TicketForm';
import { TrailingStopForm } from './TrailingStopForm';
import { AttachedStop } from './AttachedStop';
import {
  attachPlan,
  initialAttachState,
  replacesStop,
  type AttachState,
} from '../model/attachedStop';
import { attachedReviewSentence, openPositions, toAttachedParams } from '../model/trailingStopForm';
import { TicketSkeleton } from './TicketSkeleton';

export type OrderTicketProps = {
  intent: TicketIntent;
  /** Closes the slide-over (clears the ticket intent). */
  onClose: () => void;
};

/** Sets the limit price to the first LTP seen, once, unless the user already typed one. */
function LtpPrefill({
  intent,
  snapshotLtp,
  onLtp,
}: {
  intent: TicketIntent;
  snapshotLtp: number | null | undefined;
  onLtp: (ltp: number) => void;
}) {
  const ltp = useQuote(intent.symbol, intent.exchange)?.quote.ltp ?? snapshotLtp;
  useEffect(() => {
    if (ltp !== null && ltp !== undefined) onLtp(ltp);
  }, [ltp, onLtp]);
  return null;
}

const tradingAvailable = (state: TradingState) => state.status !== 'idle';
const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_TRAILING_STOP_STATUSES);
const isActiveStop = (status: string) => !TERMINAL.has(status);
const sameStops = (a: readonly TrailingStop[], b: readonly TrailingStop[]) =>
  a.length === b.length && a.every((stop, i) => stop.id === b[i]?.id && stop.seq === b[i]?.seq);

type Review = {
  request: PlaceOrderRequest;
  /** In modify mode, what changes (quantity and price only). */
  changes?: ModifyOrderRequest;
  ltp: number | null;
  value: number | null;
  /** The trailing stop attached to the entry (T14), in words for the review. */
  attached?: { sentence: string; replaces: boolean };
};

/** Cash the order already has blocked, which a modify can reuse (T-145). An estimate only. */
function blockedFor(order: Order | undefined, ltp: number | null): number {
  if (!order || order.side !== 'BUY') return 0;
  const price = order.price ?? ltp ?? 0;
  return (order.qty - order.filledQty) * price;
}

function TicketFlow({
  intent,
  instrument,
  onClose,
}: OrderTicketProps & { instrument: Instrument }) {
  const api = useApiClient();
  const toast = useToast();
  const navigate = useNavigate();
  const quoteStore = useQuoteStore();
  const { clock, alwaysOpen } = useContext(MarketSessionContext);
  const marketOpen = useMarketOpen();
  const amoDate = marketOpen ? null : amoDateFor(clock);
  const funds = useQuery(fundsSummaryQuery(api));
  const stats = useQuery(ticketStatsQuery(api, intent));
  const snapshot = useQuery(ticketQuoteQuery(api, intent));
  const placeOrder = usePlaceOrder();
  const modifyOrder = useModifyOrder();
  const modifying = intent.modify;
  const [review, setReview] = useState<Review | null>(null);
  // Confirm draws its tick before the sheet closes (A17).
  const [placed, holdThenClose] = useSuccessHold();
  const [error, setError] = useState<TicketError | null>(null);
  const [trailingMode, setTrailingMode] = useState(false);
  const [attach, setAttach] = useState<AttachState>(initialAttachState);
  // Trailing stop (T13): offered on a position in this instrument, never when modifying an order.
  const positions = useQuery({ ...positionsQuery(api), enabled: !intent.modify });
  const held = openPositions(positions.data?.items ?? [], instrument.token);
  const trailingAvailable = useTradingSelector(tradingAvailable);
  const activeStops = useTradingSelector(
    useCallback(
      (state: TradingState) =>
        state.trailingStops.filter(
          (stop) => stop.token === instrument.token && isActiveStop(stop.status),
        ),
      [instrument.token],
    ),
    sameStops,
  );
  const trailingOffer =
    !modifying && held.length > 0
      ? { available: trailingAvailable, onSelect: () => setTrailingMode(true) }
      : undefined;

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(TicketFormSchema),
    mode: 'onChange',
    defaultValues: modifying
      ? ticketValuesFromOrder(modifying)
      : defaultTicketValues(intent.side, intent),
  });
  const { control, getValues, setValue } = form;

  // Intraday is only for market hours: a closed market leaves delivery (AMO).
  const product = useWatch({ control, name: 'product' });
  useEffect(() => {
    if (!modifying && !marketOpen && product === 'INTRADAY') setValue('product', 'DELIVERY');
  }, [modifying, marketOpen, product, setValue]);

  const prefill = useCallback(
    (ltp: number) => {
      if (getValues('price') === null) setValue('price', ltp);
    },
    [getValues, setValue],
  );

  /** The latest LTP, read once (not subscribed): what a market order is valued at on submit. */
  const latestLtp = (): number | null =>
    quoteStore.get(intent.symbol, intent.exchange)?.quote.ltp ?? snapshot.data?.ltp ?? null;

  const onSubmit = form.handleSubmit((values) => {
    // An exit from the position editor closes at most what is held (NSTOCK-0395), whatever the
    // product shows: a product switch, or the closed market's switch to delivery, never lifts it.
    if (
      intent.maxQty !== undefined &&
      values.side === intent.side &&
      values.qty !== null &&
      values.qty > intent.maxQty
    ) {
      form.setError(
        'qty',
        { type: 'server', message: strings.editor.exitCap(intent.maxQty) },
        { shouldFocus: false },
      );
      return;
    }
    const ltp = latestLtp();
    const check = preCheckOrder(values, {
      now: clock.now(),
      instrument,
      stats: stats.data,
      ltp,
      availableCash:
        funds.data === undefined ? undefined : funds.data.available + blockedFor(modifying, ltp),
      forcedOpen: alwaysOpen,
    });
    if (!check.ok) {
      if (check.field === 'form') {
        setError({ title: strings.errors.cannotPlace, message: check.message });
      } else {
        form.setError(
          check.field,
          { type: 'server', message: check.message },
          { shouldFocus: false },
        );
      }
      return;
    }
    // "Add trailing stop" (T14): checked against the expected fill before the review.
    const plan = modifying ? null : attachPlan(values, attach, { trailingAvailable, ltp });
    if (plan?.attaching && !plan.check.ok) {
      setAttach((current) => ({ ...current, touched: true }));
      // The stop's fields may sit behind "More options" on a phone: say what failed up here too.
      setError({ title: strings.errors.cannotPlace, message: plan.check.message });
      return;
    }
    const attached = plan?.attaching ? toAttachedParams(attach.values) : null;
    const request = toPlaceOrderRequest(values, instrument.token, newClientOrderId(), attached);
    if (modifying) {
      const changes = toModifyRequest(values, modifying);
      if (!changes) {
        setError({ title: strings.modify.failedTitle, message: strings.modify.nothingChanged });
        return;
      }
      setError(null);
      setReview({ request, changes, ltp, value: orderValue(values, ltp) });
      return;
    }
    setError(null);
    setReview({
      request,
      ltp,
      value: orderValue(values, ltp),
      ...(attached && plan?.direction
        ? {
            attached: {
              sentence: attachedReviewSentence(attach.values, plan.direction),
              replaces: replacesStop(activeStops, values, plan.direction),
            },
          }
        : {}),
    });
  });

  const viewOrders = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    void navigate({ to: '/orders' });
  };

  const onPlaced = (order: Order) => {
    // An immediate fill may already have been toasted from its orderUpdate (T-147).
    if (order.status === 'EXECUTED' && !claimFillToast(order.id)) {
      // The live fill already toasted and played its cue.
      holdThenClose(onClose);
      return;
    }
    orderCue(order.status === 'EXECUTED' ? fillCue(order.side) : 'placed');
    toast.show({
      ...successToast(order),
      tone: 'success',
      action: {
        altText: strings.success.viewOrdersAlt,
        element: (
          <a href="/orders" onClick={viewOrders}>
            {strings.success.viewOrders}
          </a>
        ),
      },
    });
    holdThenClose(onClose);
  };

  const onModified = (order: Order) => {
    const filled = order.status === 'EXECUTED';
    if (!filled || claimFillToast(order.id)) {
      orderCue(filled ? fillCue(order.side) : 'placed');
      toast.show({ ...(filled ? successToast(order) : modifiedToast(order)), tone: 'success' });
    }
    holdThenClose(onClose);
  };

  const onConfirm = () => {
    if (!review) return;
    if (modifying && review.changes) {
      modifyOrder.mutate(
        { id: modifying.id, body: review.changes },
        {
          onSuccess: onModified,
          onError: (failure) => {
            orderCue('rejected');
            setReview(null);
            setError(describeOrderError(failure, 'modify'));
          },
        },
      );
      return;
    }
    placeOrder.mutate(review.request, {
      onSuccess: onPlaced,
      onError: (failure) => {
        // Back to the form with every value kept and the reason above the button.
        orderCue('rejected');
        setReview(null);
        setError(describeOrderError(failure));
      },
    });
  };

  return (
    <div className="grid">
      <div className="grid gap-1 border-b border-line px-4 py-3">
        {/* The sheet's title already names the stock, so a phone keeps this to one line. */}
        <p className="truncate text-body text-ink-muted max-md:hidden">{instrument.name}</p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-label font-medium text-ink">
            {strings.header.listing(instrument.symbol, instrument.exchange)}
          </span>
          <span className="sr-only">{strings.header.ltp}</span>
          <PriceCell
            symbol={intent.symbol}
            exchange={intent.exchange}
            size="md"
            initial={snapshot.data?.ltp}
          />
          <LiveChange
            symbol={intent.symbol}
            exchange={intent.exchange}
            soft
            size="sm"
            initial={
              snapshot.data
                ? { change: snapshot.data.change, changeBp: snapshot.data.changeBp }
                : undefined
            }
          />
        </div>
      </div>
      <LtpPrefill intent={intent} snapshotLtp={snapshot.data?.ltp} onLtp={prefill} />
      {trailingMode && trailingOffer?.available ? (
        <TrailingStopForm
          instrument={instrument}
          positions={held}
          activeStops={activeStops}
          snapshotLtp={snapshot.data?.ltp}
          onPlaced={onClose}
          typeControl={
            <div className="grid content-start gap-1">
              <span className="text-label text-ink-muted" aria-hidden="true">
                {strings.form.type}
              </span>
              <SegmentedControl
                label={strings.form.type}
                size="sm"
                value={TRAILING_SL}
                onValueChange={(next) => {
                  if (next === TRAILING_SL) return;
                  setValue('type', next);
                  setTrailingMode(false);
                }}
                options={orderTypeOptions(trailingOffer)}
              />
            </div>
          }
        />
      ) : review ? (
        <ReviewStep
          request={review.request}
          symbol={instrument.symbol}
          exchange={instrument.exchange}
          ltp={review.ltp}
          value={review.value}
          amoDate={amoDate}
          mode={modifying ? 'modify' : 'place'}
          {...(review.attached ? { attached: review.attached } : {})}
          placing={placeOrder.isPending || modifyOrder.isPending}
          placed={placed}
          onEdit={() => setReview(null)}
          onConfirm={onConfirm}
        />
      ) : (
        <TicketForm
          form={form}
          instrument={instrument}
          marketOpen={marketOpen}
          amoDate={amoDate}
          modifying={modifying}
          snapshotLtp={snapshot.data?.ltp}
          available={funds.data?.available}
          fundsLoading={funds.isPending}
          error={error}
          onSubmit={(event) => void onSubmit(event)}
          trailing={trailingOffer}
          compact={intent.compact === true && !modifying}
          attachNeedsAttention={!modifying && attach.enabled && attach.touched}
          attach={
            modifying ? undefined : (
              <AttachedStop
                control={control}
                symbol={intent.symbol}
                exchange={intent.exchange}
                snapshotLtp={snapshot.data?.ltp}
                trailingAvailable={trailingAvailable}
                activeStops={activeStops}
                state={attach}
                onState={setAttach}
              />
            )
          }
        />
      )}
    </div>
  );
}

/**
 * The order ticket (T-135 to T-139), loaded lazily inside the slide-over: loads the instrument
 * (for its token and tick size), then runs form → review → place. With `intent.modify` it modifies
 * that open order instead (T-145): same form, side, product and type locked, quantity and price
 * editable, then review → modify. Paper trading only.
 */
export function OrderTicket({ intent, onClose }: OrderTicketProps) {
  const api = useApiClient();
  const instrument = useQuery(ticketInstrumentQuery(api, intent));
  if (instrument.isError) {
    return (
      <ErrorState
        title={strings.loadError.title}
        description={strings.loadError.body}
        retryLabel={strings.loadError.retry}
        onRetry={() => void instrument.refetch()}
      />
    );
  }
  if (!instrument.data) return <TicketSkeleton />;
  if (instrument.data.type !== 'EQUITY') {
    return <p className="p-4 text-body text-ink">{strings.notTradable}</p>;
  }
  return <TicketFlow intent={intent} instrument={instrument.data} onClose={onClose} />;
}

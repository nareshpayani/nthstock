import type { Exchange, Instrument, Order } from '@nthstock/contracts';
import {
  Button,
  Field,
  IconAlert,
  IconClock,
  NumberInput,
  SegmentedControl,
  Switch,
  cn,
} from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useEffect, useId, useRef, useState, type FormEventHandler, type ReactNode } from 'react';
import { Controller, useWatch, type Control, type UseFormReturn } from 'react-hook-form';
import { useDockedPanels, usePhoneLayout } from '@/shared/hooks/usePhoneLayout';
import { useQuote } from '@/shared/hooks/useQuote';
import { useOffline } from '@/shared/lib/connectivity';
import type { TicketError } from '../model/orderError';
import { fillsImmediately, type TicketFormValues } from '../model/ticketForm';
import type { TrailingFormValues } from '../model/trailingStopForm';
import { strings } from '../strings';
import { DepthMiniPanel } from './DepthMiniPanel';
import { OrderEstimate } from './OrderEstimate';
import { TrailingParamsFields } from './TrailingParamsFields';
import { TicketRuler, type RulerField } from './TicketRuler';

export type TicketFormProps = {
  form: UseFormReturn<TicketFormValues>;
  instrument: Pick<Instrument, 'symbol' | 'exchange' | 'tickSize'> & { exchange: Exchange };
  marketOpen: boolean;
  /** The AMO date ("28 Sept 2026") while the market is closed. */
  amoDate: string | null;
  /** The open order being modified (T-145): side, product and type are locked. */
  modifying?: Order | undefined;
  snapshotLtp: number | null | undefined;
  available: number | undefined;
  fundsLoading: boolean;
  /** A refusal from the pre-check or the server, shown above the button. */
  error: TicketError | null;
  onSubmit: FormEventHandler<HTMLFormElement>;
  /**
   * The Trailing stop order type (T13), offered when the user holds a position in the instrument;
   * `available` is false where the backend has no trailing stops yet (api mode).
   */
  trailing?: { available: boolean; onSelect: () => void } | undefined;
  /** "Add trailing stop" on a new Market or Limit entry (T14), shown above the estimate. */
  attach?: ReactNode;
  /**
   * The compact ticket placed from the chart (T17, SPEC-TFC-1 §8.2): a limit at the chart's
   * price, so no order-type switch and no depth panel.
   */
  compact?: boolean | undefined;
  /** The attached stop was edited or refused: keep its fields in view on a phone. */
  attachNeedsAttention?: boolean | undefined;
};

export type AttachProps = {
  /** Unavailable where the backend has no trailing stops; `notForSale` on a Delivery sell. */
  status: 'available' | 'unavailable' | 'notForSale';
  enabled: boolean;
  onToggle: (on: boolean) => void;
  values: TrailingFormValues;
  onChange: (patch: Partial<TrailingFormValues>, typed?: boolean) => void;
  errorFor: (field: 'value' | 'exitLimitOffset') => string | undefined;
  preview: string | null;
  /** The entry adds to a position that already has a trailing stop, which this one replaces. */
  replaces: boolean;
};

/** The "Add trailing stop" switch and, when on, the stop's parameters (T14, SPEC-TFC-1 §7). */
export function AttachSection({ attach }: { attach: AttachProps }) {
  const offered = attach.status === 'available';
  const hint =
    attach.status === 'unavailable'
      ? strings.trailing.attachUnavailable
      : attach.status === 'notForSale'
        ? strings.trailing.attachNotForSale
        : strings.trailing.attachHint;
  return (
    <fieldset
      className="grid gap-3 rounded-md border border-line p-3"
      data-testid="attach-trailing"
    >
      <legend className="sr-only">{strings.trailing.attach}</legend>
      <div className="grid gap-1">
        <Switch
          label={strings.trailing.attach}
          checked={offered && attach.enabled}
          onCheckedChange={attach.onToggle}
          disabled={!offered}
          className="min-h-11"
        />
        <p className="text-label text-ink-muted">{hint}</p>
      </div>
      {offered && attach.enabled ? (
        <>
          <TrailingParamsFields
            values={attach.values}
            onChange={attach.onChange}
            errorFor={attach.errorFor}
            preview={attach.preview}
          />
          {attach.replaces ? (
            <p className="text-body text-ink">{strings.trailing.attachedReplaces}</p>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}

/**
 * "This will fill immediately" under the price (SPEC-TFC-1 §8.2): a limit buy above the LTP, or a
 * sell below it, crosses the market. Its own component, so live ticks re-render only this line.
 */
function ImmediateFillNote({
  symbol,
  exchange,
  control,
  snapshotLtp,
}: {
  symbol: string;
  exchange: Exchange;
  control: Control<TicketFormValues>;
  snapshotLtp: number | null | undefined;
}) {
  const [side, type, price] = useWatch({ control, name: ['side', 'type', 'price'] });
  const ltp = useQuote(symbol, exchange)?.quote.ltp ?? snapshotLtp;
  if (!fillsImmediately({ side, type, price }, ltp)) return null;
  return (
    <p
      data-testid="fills-immediately"
      className="flex items-start gap-2 rounded-md bg-marigold-soft p-3 text-body text-ink"
    >
      <IconAlert size={18} className="mt-0.5 shrink-0" />
      <span>{strings.form.fillsImmediately}</span>
    </p>
  );
}

/** The order type value that switches the ticket to the trailing-stop form (T13). */
export const TRAILING_SL = 'TRAILING_SL';

/** Market, Limit, and Trailing stop when the user holds a position (disabled where unavailable). */
export function orderTypeOptions(trailing: TicketFormProps['trailing']) {
  return [
    { value: 'MARKET' as const, label: strings.form.market },
    { value: 'LIMIT' as const, label: strings.form.limit },
    ...(trailing
      ? [
          {
            value: TRAILING_SL as typeof TRAILING_SL,
            label: trailing.available ? strings.trailing.type : strings.trailing.notAvailable,
            disabled: !trailing.available,
          },
        ]
      : []),
  ];
}

/**
 * The ticket form (T-136): side, product, order type, quantity stepper and price (disabled and
 * prefilled with the LTP for a market order), the depth mini-panel (T-137), the AMO banner while
 * the market is closed (T-138), live required amount and available cash. Errors show inline under
 * each field; a refusal shows above the button and takes focus.
 */
export function TicketForm({
  form,
  instrument,
  marketOpen,
  amoDate,
  modifying,
  snapshotLtp,
  available,
  fundsLoading,
  error,
  onSubmit,
  trailing,
  attach,
  compact = false,
  attachNeedsAttention = false,
}: TicketFormProps) {
  const offline = useOffline();
  const offlineId = useId();
  const { control, formState, setValue, trigger } = form;
  const [side, type, product] = useWatch({ control, name: ['side', 'type', 'product'] });
  // On a phone the ticket shows the essentials and keeps the rest behind "More options", so the
  // primary button sits in reach (SPEC-CR-1 §5.5, CR-T11). A product error opens it. A panel
  // docked on a tablet is phone-narrow, so it takes the same short form (§6.2).
  const docked = useDockedPanels();
  const phone = usePhoneLayout() || docked;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  // An error in a hidden control holds the section open, so Place never fails silently.
  const forcedOpen = formState.errors.product !== undefined || attachNeedsAttention;
  const showMore = !phone || moreOpen || forcedOpen;
  const qtyBox = useRef<HTMLDivElement>(null);
  // The ruler (A8) sets the field last focused.
  const [rulerField, setRulerField] = useState<RulerField>('qty');
  const [qty, price] = useWatch({ control, name: ['qty', 'price'] });
  const errorBox = useRef<HTMLDivElement>(null);

  // Quantity takes focus once the ticket has loaded (the sheet focused its close button first).
  useEffect(() => {
    qtyBox.current?.querySelector('input')?.focus();
  }, []);

  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  const pickPrice = (price: number) => {
    setValue('type', 'LIMIT', { shouldDirty: true });
    setValue('price', price, { shouldDirty: true });
    void trigger('price');
  };

  const sideLabel = strings.sides[side];
  const locked = modifying !== undefined;
  const submitLabel = locked
    ? strings.modify.submit
    : marketOpen
      ? strings.form.submit(sideLabel, instrument.symbol)
      : strings.form.placeAmo;

  const productBlock = (
    <div className="grid gap-1">
      <span className="text-label text-ink-muted" aria-hidden="true">
        {strings.form.product}
      </span>
      <Controller
        control={control}
        name="product"
        render={({ field }) => (
          <SegmentedControl
            label={strings.form.product}
            size="sm"
            disabled={locked}
            value={field.value}
            onValueChange={field.onChange}
            options={[
              { value: 'DELIVERY', label: strings.form.delivery },
              { value: 'INTRADAY', label: strings.form.intraday, disabled: !marketOpen },
            ]}
          />
        )}
      />
      {!marketOpen && !locked ? (
        <p className="text-label text-ink-muted">{strings.form.intradayClosed}</p>
      ) : null}
    </div>
  );
  const typeBlock = compact ? null : (
    <div className="grid content-start gap-1">
      <span className="text-label text-ink-muted" aria-hidden="true">
        {strings.form.type}
      </span>
      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <SegmentedControl
            label={strings.form.type}
            size="sm"
            disabled={locked}
            value={field.value}
            onValueChange={(next) => {
              if (next === TRAILING_SL) {
                trailing?.onSelect();
                return;
              }
              field.onChange(next);
              void trigger('price');
            }}
            options={orderTypeOptions(trailing)}
          />
        )}
      />
      {trailing && !trailing.available ? (
        <p className="text-label text-ink-muted">{strings.trailing.notAvailableHint}</p>
      ) : null}
    </div>
  );
  // Product, depth and the attached trailing stop: beside the essentials on wider screens, behind
  // "More options" on a phone.
  const more = (
    <>
      {phone ? productBlock : null}
      {compact || (locked && type === 'MARKET') ? null : (
        <DepthMiniPanel instrument={instrument} live={marketOpen} onPick={pickPrice} />
      )}
      {locked ? null : attach}
    </>
  );

  return (
    <form noValidate aria-label={strings.form.label} onSubmit={onSubmit} className="grid gap-4 p-4">
      {amoDate ? (
        <p className="flex items-start gap-2 rounded-md bg-marigold-soft p-3 text-body text-ink">
          <IconClock size={18} className="mt-0.5 shrink-0" />
          <span>{strings.amo.banner(amoDate)}</span>
        </p>
      ) : null}

      <Controller
        control={control}
        name="side"
        render={({ field }) => (
          <SegmentedControl
            label={strings.form.side}
            disabled={locked}
            value={field.value}
            onValueChange={field.onChange}
            options={[
              { value: 'BUY', label: strings.form.buy, tone: 'solid' },
              { value: 'SELL', label: strings.form.sell, tone: 'down' },
            ]}
          />
        )}
      />

      {phone ? (
        typeBlock
      ) : (
        <div className="grid gap-3 @min-[440px]:grid-cols-2 [&>*]:min-w-0">
          {productBlock}
          {typeBlock}
        </div>
      )}

      <div className="grid gap-3 @min-[440px]:grid-cols-2 [&>*]:min-w-0">
        <Controller
          control={control}
          name="qty"
          render={({ field, fieldState }) => (
            <Field label={strings.form.qty} error={fieldState.error?.message} className="min-w-0">
              <div ref={qtyBox} className="min-w-0" onFocusCapture={() => setRulerField('qty')}>
                <NumberInput
                  className="w-full min-w-0"
                  mode="integer"
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                />
              </div>
            </Field>
          )}
        />
        <Controller
          control={control}
          name="price"
          render={({ field, fieldState }) => (
            <Field
              className="min-w-0"
              label={strings.form.price}
              error={type === 'LIMIT' ? fieldState.error?.message : undefined}
              hint={
                type === 'LIMIT'
                  ? strings.form.limitPriceHint(formatInr(instrument.tickSize))
                  : strings.form.marketPriceHint
              }
            >
              <div className="min-w-0" onFocusCapture={() => setRulerField('price')}>
                <NumberInput
                  className="w-full min-w-0"
                  mode="price"
                  name={field.name}
                  step={instrument.tickSize}
                  value={field.value}
                  onChange={field.onChange}
                  disabled={type === 'MARKET'}
                />
              </div>
            </Field>
          )}
        />
      </div>
      {phone ? (
        <TicketRuler
          field={rulerField}
          qty={qty}
          onQty={(next) => {
            setValue('qty', next, { shouldDirty: true });
            void trigger('qty');
          }}
          price={price}
          onPrice={(next) => {
            setValue('price', next, { shouldDirty: true });
            void trigger('price');
          }}
          fallbackPrice={snapshotLtp ?? null}
          tickSize={instrument.tickSize}
          priceEnabled={type === 'LIMIT'}
        />
      ) : null}

      {locked ? (
        <p className="text-label text-ink-muted">
          {modifying.filledQty > 0
            ? `${strings.modify.locked} ${strings.modify.filled(modifying.filledQty)}.`
            : strings.modify.locked}
        </p>
      ) : null}

      <ImmediateFillNote
        symbol={instrument.symbol}
        exchange={instrument.exchange}
        control={control}
        snapshotLtp={snapshotLtp}
      />

      {phone ? null : more}

      <OrderEstimate
        symbol={instrument.symbol}
        exchange={instrument.exchange}
        control={control}
        snapshotLtp={snapshotLtp}
        available={available}
        fundsLoading={fundsLoading}
      />

      {error ? (
        <div
          ref={errorBox}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-2 rounded-md border border-l-4 border-line border-l-down bg-surface p-3 outline-none"
        >
          <IconAlert size={18} className="mt-0.5 shrink-0 text-down" />
          <div className="grid gap-0.5">
            <p className="text-body font-semibold text-ink">{error.title}</p>
            <p className="text-label text-ink">{error.message}</p>
          </div>
        </div>
      ) : null}

      {phone ? (
        <div className="grid gap-3">
          <button
            type="button"
            aria-expanded={showMore}
            aria-controls={moreId}
            disabled={forcedOpen}
            onClick={() => setMoreOpen((open) => !open)}
            className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-line px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-brand"
          >
            <span className="font-medium">{strings.form.moreOptions}</span>
            <span className="flex items-center gap-2 text-label text-ink-muted">
              {strings.products[product]}
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                className={cn(
                  'transition-transform duration-[var(--nth-duration-fast)] motion-reduce:transition-none',
                  showMore && 'rotate-180',
                )}
              >
                <path
                  d="M2.5 4.5 6 8l3.5-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </span>
          </button>
          <div id={moreId} hidden={!showMore} className="grid gap-4">
            {showMore ? more : null}
          </div>
        </div>
      ) : null}

      <p className="text-center text-label text-ink-muted">{strings.form.paperNote}</p>

      {/* Pinned to the sheet's foot, so it never scrolls out of reach while the user edits
          (SPEC-CR-1 §5.5, AC-07). */}
      <div
        data-testid="ticket-primary"
        className="sticky bottom-0 z-10 -mx-4 -mb-4 grid gap-2 border-t border-line bg-surface px-4 pt-3 pb-4"
      >
        {offline ? (
          <p id={offlineId} role="status" className="text-center text-label text-ink">
            {strings.form.offline}
          </p>
        ) : null}
        <Button
          type="submit"
          size="lg"
          block
          variant={side === 'BUY' ? 'buy' : 'sell'}
          disabled={formState.isSubmitting || offline}
          aria-describedby={offline ? offlineId : undefined}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

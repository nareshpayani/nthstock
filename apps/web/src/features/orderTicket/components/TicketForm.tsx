import type { Exchange, Instrument } from '@nthstock/contracts';
import { Button, Field, IconAlert, IconClock, NumberInput, SegmentedControl } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useEffect, useRef, type FormEventHandler } from 'react';
import { Controller, useWatch, type UseFormReturn } from 'react-hook-form';
import type { TicketError } from '../model/orderError';
import type { TicketFormValues } from '../model/ticketForm';
import { strings } from '../strings';
import { DepthMiniPanel } from './DepthMiniPanel';
import { OrderEstimate } from './OrderEstimate';

export type TicketFormProps = {
  form: UseFormReturn<TicketFormValues>;
  instrument: Pick<Instrument, 'symbol' | 'exchange' | 'tickSize'> & { exchange: Exchange };
  marketOpen: boolean;
  /** The AMO date ("28 Sept 2026") while the market is closed. */
  amoDate: string | null;
  snapshotLtp: number | null | undefined;
  available: number | undefined;
  fundsLoading: boolean;
  /** A refusal from the pre-check or the server, shown above the button. */
  error: TicketError | null;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

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
  snapshotLtp,
  available,
  fundsLoading,
  error,
  onSubmit,
}: TicketFormProps) {
  const { control, formState, setValue, trigger } = form;
  const [side, type] = useWatch({ control, name: ['side', 'type'] });
  const qtyBox = useRef<HTMLDivElement>(null);
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
  const submitLabel = marketOpen
    ? strings.form.submit(sideLabel, instrument.symbol)
    : strings.form.placeAmo;

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
            value={field.value}
            onValueChange={field.onChange}
            options={[
              { value: 'BUY', label: strings.form.buy, tone: 'up' },
              { value: 'SELL', label: strings.form.sell, tone: 'down' },
            ]}
          />
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2">
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
                value={field.value}
                onValueChange={field.onChange}
                options={[
                  { value: 'DELIVERY', label: strings.form.delivery },
                  { value: 'INTRADAY', label: strings.form.intraday, disabled: !marketOpen },
                ]}
              />
            )}
          />
          {!marketOpen ? (
            <p className="text-label text-ink-muted">{strings.form.intradayClosed}</p>
          ) : null}
        </div>
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
                value={field.value}
                onValueChange={(next) => {
                  field.onChange(next);
                  void trigger('price');
                }}
                options={[
                  { value: 'MARKET', label: strings.form.market },
                  { value: 'LIMIT', label: strings.form.limit },
                ]}
              />
            )}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Controller
          control={control}
          name="qty"
          render={({ field, fieldState }) => (
            <Field label={strings.form.qty} error={fieldState.error?.message}>
              <div ref={qtyBox}>
                <NumberInput
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
              label={strings.form.price}
              error={type === 'LIMIT' ? fieldState.error?.message : undefined}
              hint={
                type === 'LIMIT'
                  ? strings.form.limitPriceHint(formatInr(instrument.tickSize))
                  : strings.form.marketPriceHint
              }
            >
              <NumberInput
                mode="price"
                name={field.name}
                step={instrument.tickSize}
                value={field.value}
                onChange={field.onChange}
                disabled={type === 'MARKET'}
              />
            </Field>
          )}
        />
      </div>

      <DepthMiniPanel instrument={instrument} live={marketOpen} onPick={pickPrice} />

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

      <div className="grid gap-2">
        <Button
          type="submit"
          size="lg"
          block
          variant={side === 'BUY' ? 'buy' : 'sell'}
          disabled={formState.isSubmitting}
        >
          {submitLabel}
        </Button>
        <p className="text-center text-label text-ink-muted">{strings.form.paperNote}</p>
      </div>
    </form>
  );
}

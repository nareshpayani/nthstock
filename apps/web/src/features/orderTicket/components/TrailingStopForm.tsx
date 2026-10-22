import { isApiError } from '@nthstock/apiClient';
import type { Instrument, Position, TrailingStop } from '@nthstock/contracts';
import { Button, Field, IconAlert, NumberInput, SegmentedControl, useToast } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuote } from '@/shared/hooks/useQuote';
import { usePlaceTrailingStop } from '../hooks/usePlaceTrailingStop';
import {
  checkTrailing,
  defaultTrailingValues,
  directionOf,
  previewText,
  reviewSentence,
  toPlaceTrailingStopRequest,
  trailOf,
  type TrailingCheck,
  type TrailingFormValues,
} from '../model/trailingStopForm';
import { previewTrailingStop } from '@nthstock/paperEngine';
import { strings } from '../strings';

export type TrailingStopFormProps = {
  instrument: Pick<Instrument, 'token' | 'symbol' | 'exchange'>;
  /** The open positions in this instrument (one per product). */
  positions: readonly Position[];
  /** Active stops in this instrument: placing on a position that has one replaces it. */
  activeStops: readonly TrailingStop[];
  snapshotLtp: number | null | undefined;
  /** The order type control, rendered at the top so the user can go back to Market or Limit. */
  typeControl: ReactNode;
  onPlaced: () => void;
};

/**
 * The Trailing SL order type (T13, SPEC-TFC-1 §7): an exit for an open position. The quantity is
 * the position's and is stated, not typed; with both a Delivery and an Intraday position the user
 * picks which. The §6.6 messages show under the fields as the user types, a live preview states
 * the initial stop, and the review restates the behaviour in one sentence before confirming.
 */
export function TrailingStopForm({
  instrument,
  positions,
  activeStops,
  snapshotLtp,
  typeControl,
  onPlaced,
}: TrailingStopFormProps) {
  const toast = useToast();
  const place = usePlaceTrailingStop();
  const ltp = useQuote(instrument.symbol, instrument.exchange)?.quote.ltp ?? snapshotLtp ?? null;
  const [values, setValues] = useState<TrailingFormValues>(() =>
    defaultTrailingValues(positions[0]?.product ?? 'DELIVERY'),
  );
  const [touched, setTouched] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  const position = positions.find((p) => p.product === values.product) ?? positions[0];
  const direction = position ? directionOf(position) : 'LONG';
  const check: TrailingCheck = checkTrailing(values, { position, ltp });
  const shown = touched ? check : ({ ok: true } as const);
  const errorFor = (field: 'value' | 'exitLimitOffset') =>
    !shown.ok && shown.field === field ? shown.message : undefined;
  const preview = previewText(values, ltp, direction);
  const replaces = activeStops.some((stop) => stop.product === values.product);

  useEffect(() => {
    if (reviewing) heading.current?.focus();
  }, [reviewing]);

  const set = (patch: Partial<TrailingFormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    setFailure(null);
  };

  const trail = trailOf(values);
  const stopPrice =
    trail && ltp !== null && values.value !== 0
      ? previewTrailingStop({ trail, activationPrice: values.activationPrice }, ltp, direction)
          .stopPrice
      : null;
  const qty = position ? Math.abs(position.netQty) : 0;
  const exitValue = stopPrice === null ? null : stopPrice * qty;

  const onConfirm = () => {
    if (!position || !check.ok) return;
    place.mutate(toPlaceTrailingStopRequest(values, instrument.token), {
      onSuccess: (stop) => {
        toast.show({
          title: strings.trailing.placed,
          description: strings.trailing.placedDescription(
            formatInr(stop.stopPrice ?? stopPrice ?? 0),
          ),
          tone: 'success',
        });
        onPlaced();
      },
      onError: (error) => {
        setReviewing(false);
        setFailure(
          isApiError(error) && error.kind !== 'network' && error.status < 500
            ? error.message
            : strings.trailing.failed,
        );
      },
    });
  };

  if (reviewing && position) {
    return (
      <section className="grid gap-4 p-4" aria-labelledby={headingId}>
        <h3
          id={headingId}
          ref={heading}
          tabIndex={-1}
          className="text-lg font-semibold text-ink outline-none"
        >
          {strings.trailing.reviewHeading}
        </h3>
        <p className="rounded-md border border-line p-3 text-body text-ink">
          {reviewSentence(values, position, instrument.symbol)}
        </p>
        {preview ? <p className="text-body text-ink-muted">{preview}</p> : null}
        {replaces ? <p className="text-body text-ink">{strings.trailing.replaces}</p> : null}
        <p className="text-label text-ink-muted">{strings.form.paperNote}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setReviewing(false)}
            disabled={place.isPending}
          >
            {strings.review.edit}
          </Button>
          <Button size="lg" loading={place.isPending} onClick={onConfirm}>
            {strings.trailing.confirm}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form
      noValidate
      aria-label={strings.form.label}
      className="grid gap-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (check.ok) setReviewing(true);
      }}
    >
      {typeControl}

      {positions.length > 1 ? (
        <SegmentedControl
          label={strings.trailing.position}
          size="sm"
          value={values.product}
          onValueChange={(product) => set({ product })}
          options={positions.map((p) => ({
            value: p.product,
            label: strings.trailing.positionOption(strings.products[p.product], Math.abs(p.netQty)),
          }))}
        />
      ) : null}

      {position ? (
        <p className="rounded-md bg-canvas p-3 text-body text-ink" data-testid="trailing-protects">
          {strings.trailing.protects(
            direction === 'LONG' ? strings.sides.SELL : strings.sides.BUY,
            qty,
            direction === 'LONG' ? strings.trailing.long : strings.trailing.short,
          )}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <div className="grid content-start gap-1">
          <span className="text-label text-ink-muted" aria-hidden="true">
            {strings.trailing.unit}
          </span>
          <SegmentedControl
            label={strings.trailing.unit}
            size="sm"
            value={values.unit}
            onValueChange={(unit) => set({ unit, value: null })}
            options={[
              { value: 'AMOUNT', label: strings.trailing.rupees },
              { value: 'PERCENT', label: strings.trailing.percent },
            ]}
          />
        </div>
        <Field
          className="min-w-0"
          label={
            values.unit === 'AMOUNT' ? strings.trailing.valueRupees : strings.trailing.valuePercent
          }
          hint={
            values.unit === 'AMOUNT'
              ? strings.trailing.valueHintRupees
              : strings.trailing.valueHintPercent
          }
          error={errorFor('value')}
        >
          <NumberInput
            className="w-full min-w-0"
            mode="price"
            name="trailValue"
            // Rupees step by the tick; a percentage by one basis point.
            step={values.unit === 'AMOUNT' ? 5 : 1}
            min={values.unit === 'AMOUNT' ? 5 : 1}
            value={values.value}
            onChange={(value) => {
              set({ value });
              setTouched(true);
            }}
          />
        </Field>
      </div>

      <Field
        label={strings.trailing.activation}
        hint={strings.trailing.activationHint}
        className="min-w-0"
      >
        <NumberInput
          className="w-full min-w-0"
          mode="price"
          name="activationPrice"
          value={values.activationPrice}
          onChange={(activationPrice) => set({ activationPrice })}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <div className="grid content-start gap-1">
          <span className="text-label text-ink-muted" aria-hidden="true">
            {strings.trailing.exitType}
          </span>
          <SegmentedControl
            label={strings.trailing.exitType}
            size="sm"
            value={values.exitOrderType}
            onValueChange={(exitOrderType) =>
              set({ exitOrderType, exitLimitOffset: exitOrderType === 'LIMIT' ? 0 : null })
            }
            options={[
              { value: 'MARKET', label: strings.form.market },
              { value: 'LIMIT', label: strings.form.limit },
            ]}
          />
        </div>
        {values.exitOrderType === 'LIMIT' ? (
          <Field
            className="min-w-0"
            label={strings.trailing.offset}
            hint={strings.trailing.offsetHint}
            error={errorFor('exitLimitOffset')}
          >
            <NumberInput
              className="w-full min-w-0"
              mode="price"
              name="exitLimitOffset"
              min={0}
              value={values.exitLimitOffset}
              onChange={(exitLimitOffset) => set({ exitLimitOffset })}
            />
          </Field>
        ) : null}
      </div>

      <p className="text-body text-ink" aria-live="polite" data-testid="trailing-preview">
        {preview ?? strings.trailing.previewWaiting}
      </p>

      <dl className="grid grid-cols-2 gap-4 rounded-md bg-canvas p-3">
        <div className="grid gap-0.5">
          <dt className="text-label text-ink-muted">{strings.trailing.exitValue}</dt>
          <dd className="font-mono text-body font-semibold text-ink tabular-nums">
            {exitValue === null ? strings.form.unknownAmount : formatInr(exitValue)}
          </dd>
        </div>
        <div className="grid gap-0.5 text-right">
          <dt className="text-label text-ink-muted">{strings.trailing.marginRequired}</dt>
          <dd className="font-mono text-body text-ink tabular-nums" data-testid="trailing-margin">
            {formatInr(0)}
          </dd>
        </div>
        <p className="col-span-2 text-label text-ink-muted">{strings.trailing.noMargin}</p>
      </dl>

      {replaces ? <p className="text-body text-ink">{strings.trailing.replaces}</p> : null}

      {(!shown.ok && shown.field === 'form') || failure ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-l-4 border-line border-l-down bg-surface p-3"
        >
          <IconAlert size={18} className="mt-0.5 shrink-0 text-down" />
          <div className="grid gap-0.5">
            {failure ? (
              <p className="text-body font-semibold text-ink">{strings.trailing.failedTitle}</p>
            ) : null}
            <p className="text-label text-ink">{failure ?? (!shown.ok ? shown.message : null)}</p>
          </div>
        </div>
      ) : null}

      <Button type="submit" size="lg" disabled={!position}>
        {strings.trailing.submit}
      </Button>
      <p className="text-label text-ink-muted">{strings.form.paperNote}</p>
    </form>
  );
}

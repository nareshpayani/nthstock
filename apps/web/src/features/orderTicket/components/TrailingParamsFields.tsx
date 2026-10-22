import { Field, NumberInput, SegmentedControl } from '@nthstock/ui';
import type { TrailingFormValues } from '../model/trailingStopForm';
import { strings } from '../strings';

export type TrailingParamsFieldsProps = {
  values: TrailingFormValues;
  /** A change to the values; `typed` is true when the user typed the trail value. */
  onChange: (patch: Partial<TrailingFormValues>, typed?: boolean) => void;
  errorFor: (field: 'value' | 'exitLimitOffset') => string | undefined;
  /** The live preview sentence, or null while there is not enough to say. */
  preview: string | null;
};

/**
 * A trailing stop's parameters (SPEC-TFC-1 §7): unit (₹ or %), trail value, optional activation
 * price, exit type with a limit offset, and the live preview. Shared by the Trailing SL order type
 * (T13) and "Add trailing stop" on an entry (T14), so both read and check the same.
 */
export function TrailingParamsFields({
  values,
  onChange,
  errorFor,
  preview,
}: TrailingParamsFieldsProps) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <div className="grid content-start gap-1">
          <span className="text-label text-ink-muted" aria-hidden="true">
            {strings.trailing.unit}
          </span>
          <SegmentedControl
            label={strings.trailing.unit}
            size="sm"
            value={values.unit}
            onValueChange={(unit) => onChange({ unit, value: null })}
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
            onChange={(value) => onChange({ value }, true)}
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
          onChange={(activationPrice) => onChange({ activationPrice })}
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
              onChange({ exitOrderType, exitLimitOffset: exitOrderType === 'LIMIT' ? 0 : null })
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
              onChange={(exitLimitOffset) => onChange({ exitLimitOffset })}
            />
          </Field>
        ) : null}
      </div>

      <p className="text-body text-ink" aria-live="polite" data-testid="trailing-preview">
        {preview ?? strings.trailing.previewWaiting}
      </p>
    </>
  );
}

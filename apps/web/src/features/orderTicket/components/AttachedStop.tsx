import type { Exchange, TrailingStop } from '@nthstock/contracts';
import { useWatch, type Control } from 'react-hook-form';
import { useQuote } from '@/shared/hooks/useQuote';
import { attachPlan, replacesStop, type AttachState } from '../model/attachedStop';
import type { TicketFormValues } from '../model/ticketForm';
import { attachedPreviewText, type TrailingFormValues } from '../model/trailingStopForm';
import { AttachSection } from './TicketForm';

export type AttachedStopProps = {
  control: Control<TicketFormValues>;
  symbol: string;
  exchange: Exchange;
  snapshotLtp: number | null | undefined;
  trailingAvailable: boolean;
  activeStops: readonly TrailingStop[];
  state: AttachState;
  onState: (next: (current: AttachState) => AttachState) => void;
};

/**
 * "Add trailing stop" inside the entry ticket (T14, SPEC-TFC-1 §7). It follows the side, product,
 * type and price as they change, and the LTP for a market order, so the preview always states the
 * stop for the expected fill. Only this part re-renders on a tick, not the whole ticket.
 */
export function AttachedStop({
  control,
  symbol,
  exchange,
  snapshotLtp,
  trailingAvailable,
  activeStops,
  state,
  onState,
}: AttachedStopProps) {
  const [side, type, product, price] = useWatch({
    control,
    name: ['side', 'type', 'product', 'price'],
  });
  const ltp = useQuote(symbol, exchange)?.quote.ltp ?? snapshotLtp ?? null;
  const plan = attachPlan({ side, type, product, price }, state, { trailingAvailable, ltp });
  const shown = state.touched ? plan.check : ({ ok: true } as const);
  const errorFor = (field: 'value' | 'exitLimitOffset') =>
    !shown.ok && shown.field === field ? shown.message : undefined;
  const preview =
    plan.direction === null
      ? null
      : attachedPreviewText(state.values, plan.refPrice, plan.direction);

  return (
    <AttachSection
      attach={{
        status: plan.status,
        enabled: state.enabled,
        onToggle: (enabled) => onState((current) => ({ ...current, enabled })),
        values: state.values,
        onChange: (patch: Partial<TrailingFormValues>, typed?: boolean) =>
          onState((current) => ({
            ...current,
            values: { ...current.values, ...patch },
            touched: current.touched || Boolean(typed),
          })),
        errorFor,
        preview,
        replaces: replacesStop(activeStops, { product }, plan.direction),
      }}
    />
  );
}

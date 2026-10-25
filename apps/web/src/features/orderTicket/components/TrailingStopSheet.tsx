import { isApiError, type TradingState } from '@nthstock/apiClient';
import type { Position } from '@nthstock/contracts';
import { Button, Field, IconAlert, NumberInput, SegmentedControl, useToast } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { livePosition } from '@/features/positions';
import { PnlAmount } from '@/shared/components/PnlAmount';
import { useOpenTicket } from '@/shared/hooks/useOpenTicket';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { useQuote } from '@/shared/hooks/useQuote';
import { usePositionTrailingStop } from '@/shared/hooks/useTrailingStops';
import { useTradingSelector } from '@/shared/hooks/useTradingSelector';
import type { TrailingSheetTarget } from '@/shared/lib/trailingSheetStore';
import { trailingStopSummary } from '@/shared/lib/trailingStopView';
import { ticketQuoteQuery } from '../api/ticketQueries';
import { useCancelTrailingStop } from '../hooks/useCancelTrailingStop';
import { useModifyTrailingStop } from '../hooks/useModifyTrailingStop';
import { usePlaceTrailingStop } from '../hooks/usePlaceTrailingStop';
import {
  canMoveStop,
  defaultTrailValue,
  isActiveStop,
  isChangeableStop,
  sheetValues,
  toTermsModify,
  toTrailModify,
} from '../model/trailingSheet';
import {
  checkTrailing,
  directionOf,
  previewText,
  toPlaceTrailingStopRequest,
  trailOf,
  trailText,
  type TrailingFormValues,
} from '../model/trailingStopForm';
import { strings } from '../strings';
import { TrailingParamsFields } from './TrailingParamsFields';

export type TrailingStopSheetProps = {
  target: TrailingSheetTarget;
  onClose: () => void;
  /**
   * The position editor's stop section (NSTOCK-0395): every term (activation price, exit type),
   * moving the stop to a typed price, and only the target's product. The editor states the
   * position above it, so the sheet's own summary and "More options" are left out.
   */
  full?: boolean | undefined;
};

const samePositions = (a: readonly Position[], b: readonly Position[]) =>
  a.length === b.length &&
  a.every(
    (position, i) =>
      position.product === b[i]?.product &&
      position.netQty === b[i].netQty &&
      position.avgBuyPrice === b[i].avgBuyPrice &&
      position.avgSellPrice === b[i].avgSellPrice &&
      position.realisedPnl === b[i].realisedPnl,
  );

const failureText = (error: unknown) =>
  isApiError(error) && error.kind !== 'network' && error.status < 500
    ? error.message
    : strings.sheet.failed;

/**
 * The trailing-stop sheet (T18, SPEC-TFC-1 §8.4): opened from the position chip on the chart. It
 * states the position with its live P&L and the stop's status and current price, takes the trail
 * as a unit and value (1.0% by default, or 1% of the LTP in rupees), and sets, updates or cancels
 * the stop in one tap. "More options" opens the full ticket for the activation price and exit
 * type. Nothing is sent until a button is tapped.
 */
export function TrailingStopSheet({ target, onClose, full = false }: TrailingStopSheetProps) {
  const only = full ? target.product : undefined;
  const select = useCallback(
    (state: TradingState) =>
      state.positions.filter(
        (position) =>
          position.token === target.token &&
          position.netQty !== 0 &&
          (only === undefined || position.product === only),
      ),
    [target.token, only],
  );
  const positions = useTradingSelector(select, samePositions);
  const first = positions.find((p) => p.product === target.product) ?? positions[0];
  const [product, setProduct] = useState(first?.product ?? target.product ?? 'DELIVERY');
  const position = positions.find((p) => p.product === product) ?? first;
  if (!position) {
    return (
      <p className="p-4 text-body text-ink" role="status">
        {strings.sheet.noPosition}
      </p>
    );
  }
  return (
    <SheetBody
      key={position.product}
      target={target}
      position={position}
      positions={positions}
      onProduct={setProduct}
      onClose={onClose}
      full={full}
    />
  );
}

function SheetBody({
  target,
  position,
  positions,
  onProduct,
  onClose,
  full,
}: {
  target: TrailingSheetTarget;
  position: Position;
  positions: readonly Position[];
  onProduct: (product: Position['product']) => void;
  onClose: () => void;
  full: boolean;
}) {
  const toast = useToast();
  const openTicket = useOpenTicket();
  const place = usePlaceTrailingStop();
  const modify = useModifyTrailingStop();
  const cancel = useCancelTrailingStop();
  const api = useApiClient();
  // The live price, or the REST snapshot until the first tick arrives.
  const snapshot = useQuery(ticketQuoteQuery(api, target));
  const ltp = useQuote(target.symbol, target.exchange)?.quote.ltp ?? snapshot.data?.ltp ?? null;
  const live = livePosition(position, ltp ?? undefined);
  const stop = usePositionTrailingStop(position.token, position.product);
  const active = isActiveStop(stop) ? stop : null;
  const changeable = isChangeableStop(stop);
  const direction = directionOf(position);
  const [values, setValues] = useState<TrailingFormValues>(() =>
    sheetValues(stop, position.product),
  );
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // A switch to rupees before the first price leaves the field empty; it fills, once, when the price
  // lands (state adjusted during render, so there is no effect and no extra paint).
  const [awaitingDefault, setAwaitingDefault] = useState(false);
  if (awaitingDefault && ltp !== null) {
    setAwaitingDefault(false);
    if (values.value === null) setValues({ ...values, value: defaultTrailValue(values.unit, ltp) });
  }

  const check = checkTrailing(values, { position, ltp });
  const shown = touched ? check : ({ ok: true } as const);
  const errorFor = (field: 'value' | 'exitLimitOffset') =>
    !shown.ok && shown.field === field ? shown.message : undefined;
  // An update applies from the best price so far (§6.5); a new stop from the LTP.
  const preview = previewText(values, active?.watermarkPrice ?? ltp, direction);
  const busy = place.isPending || modify.isPending || cancel.isPending;
  const changes = active
    ? full
      ? toTermsModify(values, active)
      : toTrailModify(values, active)
    : null;
  const movable = full && canMoveStop(stop) ? stop : null;
  const [stopPrice, setStopPrice] = useState<number | null>(stop?.stopPrice ?? null);

  const onChange = (patch: Partial<TrailingFormValues>, typed?: boolean) => {
    // Switching the unit starts from that unit's default rather than an empty field (§8.4).
    const next =
      patch.unit !== undefined && patch.value === null
        ? { ...patch, value: defaultTrailValue(patch.unit, ltp) }
        : patch;
    setValues((current) => ({ ...current, ...next }));
    // Waiting only matters for a unit switch; typing a value of one's own ends it.
    if (patch.unit !== undefined) setAwaitingDefault(next.value === null);
    else if (patch.value !== undefined) setAwaitingDefault(false);
    setFailure(null);
    if (typed) setTouched(true);
  };

  const onSet = () => {
    setTouched(true);
    if (!check.ok) return;
    place.mutate(toPlaceTrailingStopRequest(values, position.token), {
      onSuccess: (placed) => {
        toast.show({
          title: strings.sheet.setDone,
          description: strings.trailing.placedDescription(formatInr(placed.stopPrice ?? 0)),
          tone: 'success',
        });
        onClose();
      },
      onError: (error) => setFailure(failureText(error)),
    });
  };

  const onUpdate = () => {
    setTouched(true);
    if (!active || !check.ok || !changes) return;
    modify.mutate(
      { id: active.id, body: changes },
      {
        onSuccess: (updated) => {
          toast.show({
            title: strings.sheet.updated,
            description: full
              ? strings.editor.updatedDescription(
                  trailText(updated.trail),
                  formatInr(updated.stopPrice ?? 0),
                )
              : strings.sheet.updatedDescription(trailText(updated.trail)),
            tone: 'success',
          });
          onClose();
        },
        onError: (error) => setFailure(failureText(error)),
      },
    );
  };

  const onMove = () => {
    if (!movable || stopPrice === null) return;
    modify.mutate(
      { id: movable.id, body: { stopPrice } },
      {
        onSuccess: (updated) => {
          toast.show({
            title: strings.editor.moved,
            description: strings.editor.movedDescription(formatInr(updated.stopPrice ?? stopPrice)),
            tone: 'success',
          });
          onClose();
        },
        onError: (error) => setFailure(failureText(error)),
      },
    );
  };

  const onCancel = () => {
    if (!active) return;
    cancel.mutate(active.id, {
      onSuccess: () => {
        toast.show({
          title: strings.sheet.cancelled,
          description: strings.sheet.cancelledDescription(target.symbol),
          tone: 'success',
        });
        onClose();
      },
      onError: (error) => setFailure(failureText(error)),
    });
  };

  const onMore = () => {
    onClose();
    void openTicket({
      symbol: target.symbol,
      exchange: target.exchange,
      side: direction === 'LONG' ? 'SELL' : 'BUY',
      product: position.product,
    });
  };

  const qty = position.netQty > 0 ? `+${String(position.netQty)}` : String(position.netQty);
  const trail = trailOf(values);

  return (
    <div className="grid gap-4 p-4">
      {positions.length > 1 ? (
        <SegmentedControl
          label={strings.trailing.position}
          size="sm"
          value={position.product}
          onValueChange={onProduct}
          options={positions.map((p) => ({
            value: p.product,
            label: strings.trailing.positionOption(strings.products[p.product], Math.abs(p.netQty)),
          }))}
        />
      ) : null}

      {full ? null : (
        <dl
          className="grid grid-cols-2 gap-3 rounded-md bg-canvas p-3"
          data-testid="sheet-position"
        >
          <div className="grid gap-0.5">
            <dt className="text-label text-ink-muted">{strings.products[position.product]}</dt>
            <dd className="font-mono text-body font-semibold text-ink tabular-nums">
              {live.avgPrice === null ? qty : strings.sheet.position(qty, formatInr(live.avgPrice))}
            </dd>
          </div>
          <div className="grid gap-0.5 text-right">
            <dt className="text-label text-ink-muted">{strings.sheet.pnl}</dt>
            <dd data-testid="sheet-pnl">
              <PnlAmount value={live.pnl} size="md" />
            </dd>
          </div>
          <div className="col-span-2 grid gap-0.5">
            <dt className="text-label text-ink-muted">{strings.sheet.status}</dt>
            <dd className="text-body font-medium text-ink" data-testid="sheet-status">
              {active ? trailingStopSummary(active) : strings.sheet.none}
            </dd>
          </div>
        </dl>
      )}

      {active && !changeable ? (
        <p className="text-body text-ink">{strings.sheet.triggered}</p>
      ) : (
        <TrailingParamsFields
          compact={!full}
          values={values}
          onChange={onChange}
          errorFor={errorFor}
          preview={preview}
        />
      )}

      {failure || (!shown.ok && shown.field === 'form') ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-l-4 border-line border-l-down bg-surface p-3"
        >
          <IconAlert size={18} className="mt-0.5 shrink-0 text-down" />
          <div className="grid gap-0.5">
            {failure ? (
              <p className="text-body font-semibold text-ink">{strings.sheet.failedTitle}</p>
            ) : null}
            <p className="text-label text-ink">{failure ?? (!shown.ok ? shown.message : null)}</p>
          </div>
        </div>
      ) : null}

      {active ? (
        changeable ? (
          <div className="grid gap-2">
            <Button
              size="lg"
              block
              loading={modify.isPending}
              disabled={busy || changes === null || trail === null}
              onClick={onUpdate}
            >
              {strings.sheet.update}
            </Button>
            {changes === null ? (
              <p className="text-center text-label text-ink-muted">
                {full ? strings.editor.unchanged : strings.sheet.unchanged}
              </p>
            ) : null}
            <Button
              variant="secondary"
              size="lg"
              block
              loading={cancel.isPending}
              disabled={busy}
              onClick={onCancel}
            >
              {strings.sheet.cancel}
            </Button>
          </div>
        ) : null
      ) : (
        <Button size="lg" block loading={place.isPending} disabled={busy} onClick={onSet}>
          {strings.sheet.set}
        </Button>
      )}

      {movable ? (
        <div className="grid gap-2 border-t border-line pt-4" data-testid="editor-move-stop">
          <Field label={strings.editor.stopPrice} hint={strings.editor.stopPriceHint}>
            <NumberInput
              className="w-full min-w-0"
              mode="price"
              name="stopPrice"
              step={5}
              min={5}
              value={stopPrice}
              onChange={(next) => {
                setStopPrice(next);
                setFailure(null);
              }}
            />
          </Field>
          <Button
            variant="secondary"
            size="lg"
            block
            loading={modify.isPending && modify.variables?.body.stopPrice !== undefined}
            disabled={busy || stopPrice === null || stopPrice === movable.stopPrice}
            onClick={onMove}
          >
            {strings.editor.move}
          </Button>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <p className="text-label text-ink-muted">{strings.form.paperNote}</p>
        {full ? null : (
          <Button variant="ghost" size="sm" onClick={onMore}>
            {strings.sheet.moreOptions}
          </Button>
        )}
      </div>
    </div>
  );
}

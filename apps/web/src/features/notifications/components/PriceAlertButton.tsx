import { ApiError } from '@nthstock/apiClient';
import type { Exchange, PriceAlert } from '@nthstock/contracts';
import { Button, Dialog, Field, IconBell, IconButton, Input, NumberInput, cn } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuote } from '@/shared/hooks/useQuote';
import { useSession } from '@/shared/hooks/useSession';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { priceAlertsQuery } from '../api/alertsQuery';
import { useCancelAlert, useCreateAlert } from '../hooks/useAlertMutations';
import { ALERT_PRESETS, conditionFor, presetLevel } from '../model/alertLevels';
import { strings } from '../strings';
import { AlertList } from './AlertList';

export type PriceAlertButtonProps = { symbol: string; exchange: Exchange };

/**
 * The bell beside the watchlist star on a stock page (NSTOCK-0344). It is filled while the stock
 * has an active alert, and opens a dialog to set one: a price (quick levels ±1% and ±2%), the
 * direction read from which side of the live price it is, and an optional note. The stock's alerts
 * are listed under the form. Logged out, it goes to log in and back.
 */
export function PriceAlertButton({ symbol, exchange }: PriceAlertButtonProps) {
  const { status } = useSession();
  const navigate = useNavigate();
  const here = useRouterState({ select: (s) => s.location.href });
  if (status !== 'authenticated') {
    return (
      <IconButton
        variant="secondary"
        label={strings.loginFirst}
        icon={<IconBell size={20} />}
        disabled={status === 'unknown'}
        onClick={() => void navigate({ to: '/login', search: { redirect: here } })}
      />
    );
  }
  return <AlertDialog symbol={symbol} exchange={exchange} />;
}

function AlertDialog({ symbol, exchange }: PriceAlertButtonProps) {
  const api = useApiClient();
  const alerts = useQuery(priceAlertsQuery(api));
  const ltp = useQuote(symbol, exchange)?.quote.ltp ?? null;
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateAlert();
  const cancel = useCancelAlert();

  const mine = (alerts.data?.items ?? []).filter(
    (alert) => alert.symbol === symbol && alert.exchange === exchange,
  );
  const active = mine.filter((alert) => alert.status === 'ACTIVE');
  const condition = price !== null && ltp !== null ? conditionFor(price, ltp) : null;

  const change = (next: boolean) => {
    setOpen(next);
    setMessage(null);
    setError(null);
    if (next && ltp !== null) setPrice(presetLevel(ltp, 1));
    if (!next) setNote('');
  };

  const submit = () => {
    if (price === null || condition === null) return;
    setError(null);
    create.mutate(
      { symbol, exchange, condition, price, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: (alert: PriceAlert) => {
          setMessage(strings.dialog.created(symbol, formatInr(alert.price)));
          setNote('');
        },
        onError: (cause) => {
          const code = cause instanceof ApiError ? cause.code : null;
          setError(
            code === 'LIMIT_REACHED'
              ? strings.dialog.limit
              : code === 'VALIDATION_ERROR'
                ? strings.dialog.passed
                : strings.dialog.error,
          );
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={change}
      title={strings.dialog.title(symbol)}
      description={strings.dialog.description}
      trigger={
        <IconButton
          variant="secondary"
          label={
            active.length > 0
              ? strings.dialog.openActive(symbol, active.length)
              : strings.dialog.open(symbol)
          }
          icon={<IconBell size={20} className={cn(active.length > 0 && 'fill-current')} />}
          className={cn(active.length > 0 && 'text-brand')}
        />
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => change(false)}>
            {strings.dialog.cancel}
          </Button>
          <Button disabled={condition === null} loading={create.isPending} onClick={submit}>
            {strings.dialog.create}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field
          label={strings.dialog.priceLabel}
          hint={ltp === null ? undefined : strings.dialog.now(formatInr(ltp))}
          error={error ?? undefined}
        >
          <NumberInput mode="price" value={price} onChange={setPrice} min={5} />
        </Field>
        {ltp === null ? null : (
          <div
            role="group"
            aria-label={strings.dialog.presetsLabel}
            className="flex flex-wrap gap-2"
          >
            {ALERT_PRESETS.map((pct) => (
              <Button
                key={pct}
                type="button"
                variant="secondary"
                size="sm"
                aria-label={strings.dialog.presetLabel(pct)}
                onClick={() => setPrice(presetLevel(ltp, pct))}
              >
                {strings.dialog.preset(pct)}
              </Button>
            ))}
          </div>
        )}
        <Field label={strings.dialog.noteLabel}>
          <Input
            value={note}
            maxLength={80}
            placeholder={strings.dialog.notePlaceholder}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <p className="text-body text-ink" aria-live="polite">
          {price !== null && condition !== null
            ? strings.dialog.when(symbol, condition, formatInr(price))
            : price !== null
              ? strings.dialog.samePrice
              : null}
        </p>
        {message ? (
          <p role="status" className="text-body font-medium text-up">
            {message}
          </p>
        ) : null}
      </form>
      {mine.length > 0 ? (
        <section className="mt-4 grid gap-1" aria-label={strings.dialog.activeTitle}>
          <h3 className="text-label font-semibold text-ink-muted">{strings.dialog.activeTitle}</h3>
          <AlertList
            items={mine}
            showSymbol={false}
            onRemove={(alert) => cancel.mutate(alert.id)}
          />
        </section>
      ) : null}
    </Dialog>
  );
}

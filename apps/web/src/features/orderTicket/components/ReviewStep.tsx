import type { Exchange, PlaceOrderRequest } from '@nthstock/contracts';
import { Button } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useEffect, useId, useRef } from 'react';
import { strings } from '../strings';

export type ReviewStepProps = {
  request: PlaceOrderRequest;
  symbol: string;
  exchange: Exchange;
  /** LTP when the review opened, to show what a market order is worth. */
  ltp: number | null;
  /** Estimated value in paise, or null when unknown. */
  value: number | null;
  /** The AMO date while the market is closed. */
  amoDate: string | null;
  placing: boolean;
  onEdit: () => void;
  onConfirm: () => void;
};

/**
 * The confirmation step (T-139): everything the order will do, in words, then Confirm. The
 * heading takes focus so a screen reader starts reading the summary.
 */
export function ReviewStep({
  request,
  symbol,
  exchange,
  ltp,
  value,
  amoDate,
  placing,
  onEdit,
  onConfirm,
}: ReviewStepProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const price =
    request.price !== undefined
      ? formatInr(request.price)
      : ltp !== null
        ? strings.review.atMarket(formatInr(ltp))
        : strings.review.atMarketNoLtp;
  const rows: [string, string][] = [
    [strings.review.side, strings.sides[request.side]],
    [strings.review.stock, strings.header.listing(symbol, exchange)],
    [strings.review.qty, String(request.qty)],
    [strings.review.type, strings.types[request.type]],
    [strings.review.price, price],
    [strings.review.product, strings.products[request.product]],
    [strings.review.value, value === null ? strings.form.unknownAmount : formatInr(value)],
  ];

  return (
    <section className="grid gap-4 p-4" aria-labelledby={headingId}>
      <h3
        id={headingId}
        ref={heading}
        tabIndex={-1}
        className="text-lg font-semibold text-ink outline-none"
      >
        {strings.review.heading}
      </h3>
      <dl className="grid gap-2 rounded-md border border-line p-3">
        {rows.map(([term, detail]) => (
          <div key={term} className="flex justify-between gap-4">
            <dt className="text-label text-ink-muted">{term}</dt>
            <dd className="text-right text-body font-medium text-ink">{detail}</dd>
          </div>
        ))}
      </dl>
      {amoDate ? (
        <p className="rounded-md bg-marigold-soft p-3 text-body text-ink">
          {strings.amo.reviewNote(amoDate)}
        </p>
      ) : null}
      <p className="text-label text-ink-muted">{strings.form.paperNote}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={onEdit} disabled={placing}>
          {strings.review.edit}
        </Button>
        <Button
          variant={request.side === 'BUY' ? 'buy' : 'sell'}
          size="lg"
          loading={placing}
          onClick={onConfirm}
        >
          {amoDate ? strings.review.confirmAmo : strings.review.confirm}
        </Button>
      </div>
    </section>
  );
}

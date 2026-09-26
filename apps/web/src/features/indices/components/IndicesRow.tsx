import { ErrorState, Skeleton } from '@nthstock/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, type KeyboardEvent } from 'react';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { indicesQuery } from '../api/indicesQuery';
import { strings } from '../strings';
import { IndexCard } from './IndexCard';

const SKELETON_CARDS = 5;

/**
 * Arrow keys move the row one card at a time, Home and End jump to the ends. The row is a
 * focusable region, so keyboard users can scroll it at all (WCAG 2.1.1).
 */
export function scrollRowByKey(row: HTMLElement, key: string): boolean {
  const card = row.querySelector('li');
  const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
  const step = (card?.getBoundingClientRect().width ?? row.clientWidth) + gap;
  switch (key) {
    case 'ArrowRight':
      row.scrollBy({ left: step });
      return true;
    case 'ArrowLeft':
      row.scrollBy({ left: -step });
      return true;
    case 'Home':
      row.scrollTo({ left: 0 });
      return true;
    case 'End':
      row.scrollTo({ left: row.scrollWidth });
      return true;
    default:
      return false;
  }
}

/** Market indices (T-096): a horizontally scrolling, snapping row of live index cards. */
export function IndicesRow() {
  const api = useApiClient();
  const indices = useQuery(indicesQuery(api));
  const headingId = useId();
  const hintId = useId();
  const rowRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !rowRef.current) return;
    if (scrollRowByKey(rowRef.current, event.key)) event.preventDefault();
  };

  return (
    <div className="grid gap-3">
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        {strings.title}
      </h2>
      <p id={hintId} className="sr-only">
        {strings.keyboardHint}
      </p>
      {indices.isError ? (
        <div className="rounded-lg border border-line bg-surface">
          <ErrorState
            title={strings.errorTitle}
            description={strings.errorBody}
            retryLabel={strings.retry}
            onRetry={() => void indices.refetch()}
          />
        </div>
      ) : indices.data ? (
        <div
          ref={rowRef}
          role="region"
          aria-labelledby={headingId}
          aria-describedby={hintId}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="snap-x snap-mandatory overflow-x-auto scroll-smooth rounded-lg pb-1 motion-reduce:scroll-auto"
        >
          <ul className="flex gap-3">
            {indices.data.items.map((summary) => (
              <IndexCard key={`${summary.exchange}:${summary.symbol}`} summary={summary} />
            ))}
          </ul>
        </div>
      ) : (
        <div role="status" aria-label={strings.loading} className="flex gap-3 overflow-hidden">
          {Array.from({ length: SKELETON_CARDS }, (_, i) => (
            <Skeleton key={i} className="h-[7.25rem] min-w-44 flex-1 rounded-lg" />
          ))}
        </div>
      )}
    </div>
  );
}

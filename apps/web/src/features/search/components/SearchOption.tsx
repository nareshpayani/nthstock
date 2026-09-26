import type { SearchHit } from '@nthstock/contracts';
import { highlightName, highlightSymbol, type TextPart } from '../model/highlight';

function Marked({ parts }: { parts: TextPart[] }) {
  return parts.map((part, i) =>
    part.match ? (
      <mark key={i} className="rounded-sm bg-marigold-soft text-ink">
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

export type SearchOptionProps = {
  id: string;
  hit: SearchHit;
  /** The query to mark in the symbol and name; empty for recent and popular rows. */
  query: string;
  selected: boolean;
  onChoose: () => void;
  onHover: () => void;
};

/** One listbox row: symbol and name (matches marked) and the exchange. */
export function SearchOption({ id, hit, query, selected, onChoose, onHover }: SearchOptionProps) {
  return (
    <div
      role="option"
      id={id}
      aria-selected={selected}
      onClick={onChoose}
      onMouseMove={selected ? undefined : onHover}
      className="flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 aria-selected:bg-brand-soft"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-ink">
          <Marked parts={highlightSymbol(hit.symbol, query)} />
        </span>
        <span className="block truncate text-label text-ink-muted">
          <Marked parts={highlightName(hit.name, query)} />
        </span>
      </span>
      <span className="shrink-0 rounded-sm border border-line px-1.5 text-label text-ink-muted">
        {hit.exchange}
      </span>
    </div>
  );
}

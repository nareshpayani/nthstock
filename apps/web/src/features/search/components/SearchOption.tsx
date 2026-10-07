import type { SearchHit } from '@nthstock/contracts';
import { IconCheck, IconPlus } from '@nthstock/ui';
import { strings } from '../strings';
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
  /** Adding to a watchlist (T-121): the list's name, whether the stock is in it, and the add. */
  add?: { listName: string; added: boolean; onAdd: () => void } | undefined;
};

/** One listbox row: symbol and name (matches marked) and the exchange. */
export function SearchOption({
  id,
  hit,
  query,
  selected,
  onChoose,
  onHover,
  add,
}: SearchOptionProps) {
  return (
    // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/interactive-supports-focus -- combobox option: focus stays in the input (aria-activedescendant), keys are handled there
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
      {add ? (
        <>
          {add.added ? <span className="sr-only">{strings.inList(add.listName)}</span> : null}
          {/*
            Pointer shortcut only. Options cannot hold focusable controls (focus stays in the
            combobox), so keyboard users add with Shift+Enter and the state is in the text above.
          */}
          <span
            aria-hidden="true"
            data-add-to-watchlist={hit.symbol}
            title={add.added ? strings.inList(add.listName) : strings.addTo(add.listName)}
            onClick={(event) => {
              event.stopPropagation();
              if (!add.added) add.onAdd();
            }}
            className={
              add.added
                ? 'flex size-7 shrink-0 items-center justify-center rounded-md text-up'
                : 'flex size-7 shrink-0 items-center justify-center rounded-md border border-line text-brand hover:bg-brand-soft'
            }
          >
            {add.added ? <IconCheck size={16} /> : <IconPlus size={16} />}
          </span>
        </>
      ) : null}
    </div>
  );
}

import { SEARCH_QUERY_MAX, type SearchHit } from '@nthstock/contracts';
import { IconSearch, Input } from '@nthstock/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { popularSearchesQuery, searchQuery } from '../api/searchQuery';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { addRecentSearch, readRecentSearches } from '../model/recentSearches';
import { strings } from '../strings';
import { SearchOption } from './SearchOption';

/** Typing pauses this long before a search request goes out (T-103). */
export const SEARCH_DEBOUNCE_MS = 150;

export type SearchBoxProps = {
  ref?: Ref<HTMLInputElement>;
  /** Called after a stock is chosen and navigation has started, e.g. to close a drawer. */
  onNavigate?: () => void;
};

type Group = { key: 'results' | 'recent' | 'popular'; title: string | null; hits: SearchHit[] };

/**
 * Stock search (T-103, T-104): a WAI-ARIA combobox with a listbox popup. Typing searches after a
 * 150 ms pause and shows symbol, name and exchange with the matched parts marked. An empty box
 * shows recent searches, then popular ones. ↑/↓ move, Enter opens /stocks/<symbol>, Esc closes the
 * list and returns focus to where it was before the search.
 */
export function SearchBox({ ref, onNavigate }: SearchBoxProps) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const id = useId();
  const listboxId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${String(index)}`;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<SearchHit[]>([]);

  const trimmed = query.trim().slice(0, SEARCH_QUERY_MAX);
  const debounced = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const typing = trimmed.length > 0;
  const listening = focused && !dismissed;

  const results = useQuery({
    ...searchQuery(api, debounced),
    enabled: listening && typing && debounced.length > 0,
    placeholderData: keepPreviousData,
  });
  const popular = useQuery({ ...popularSearchesQuery(api), enabled: listening && !typing });

  let groups: Group[];
  if (typing) {
    const hits = debounced.length > 0 ? (results.data?.items ?? []) : [];
    groups = [{ key: 'results', title: null, hits }];
  } else {
    const seen = new Set(recent.map((hit) => `${hit.exchange}:${hit.symbol}`));
    const popularHits = (popular.data?.items ?? []).filter(
      (hit) => !seen.has(`${hit.exchange}:${hit.symbol}`),
    );
    groups = [
      { key: 'recent', title: strings.recentTitle, hits: recent },
      { key: 'popular', title: strings.popularTitle, hits: popularHits },
    ];
  }
  groups = groups.filter((group) => group.hits.length > 0);
  const options = groups.flatMap((group) => group.hits);
  const activeIndex = active < options.length ? active : -1;

  const settled = debounced === trimmed && !results.isFetching;
  let message: string | null = null;
  let announcement = '';
  if (typing) {
    if (results.isError && options.length === 0) message = strings.error;
    else if (settled && options.length === 0 && debounced.length > 0)
      message = strings.noResults(trimmed);
    else if (options.length === 0) message = strings.searching;
    if (settled && !results.isError) announcement = strings.resultCount(options.length);
    if (results.isError) announcement = strings.error;
  }
  const expanded = listening && (options.length > 0 || message !== null);
  const activeId = expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined;

  useEffect(() => {
    // jsdom has no scrollIntoView, hence the optional call.
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const choose = (hit: SearchHit) => {
    setRecent(addRecentSearch(hit));
    setQuery('');
    setActive(-1);
    setDismissed(true);
    void navigate({ to: '/stocks/$symbol', params: { symbol: hit.symbol } });
    onNavigate?.();
  };

  /** Enter with nothing highlighted: the first result for exactly what is typed. */
  const chooseFirstMatch = async () => {
    try {
      const { items } = await queryClient.fetchQuery(searchQuery(api, trimmed));
      const first = items[0];
      if (first) choose(first);
    } catch {
      // The results query shows the error.
    }
  };

  const close = () => {
    setDismissed(true);
    setActive(-1);
  };

  /**
   * Back to where focus was before the search (the "/" shortcut starts from the page). Inside a
   * dialog focus stays in the dialog, so it stays in the box when it came from outside.
   */
  const returnFocusAfterEscape = () => {
    const input = inputRef.current;
    const back = returnFocus.current;
    const scope = input?.closest('[role="dialog"]') ?? null;
    if (back?.isConnected && back !== input && (!scope || scope.contains(back))) back.focus();
    else if (!scope) input?.blur();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = options.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!expanded) {
          setDismissed(false);
          setActive(-1);
          return;
        }
        if (count === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const from = activeIndex < 0 ? (step === 1 ? -1 : count) : activeIndex;
        setActive((from + step + count) % count);
        return;
      }
      case 'Enter': {
        event.preventDefault();
        const hit = expanded ? options[activeIndex] : undefined;
        if (hit) choose(hit);
        else if (typing) void chooseFirstMatch();
        return;
      }
      case 'Escape': {
        if (!expanded) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        returnFocusAfterEscape();
        return;
      }
      default:
    }
  };

  const onFocus = (event: FocusEvent<HTMLInputElement>) => {
    returnFocus.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
    setRecent(readRecentSearches());
    setFocused(true);
    setDismissed(false);
  };

  const onBlur = () => {
    setFocused(false);
    setActive(-1);
  };

  let index = 0;
  return (
    <div className="relative min-w-0 flex-1">
      <form role="search" onSubmit={(event) => event.preventDefault()}>
        <Input
          ref={setRefs}
          type="search"
          role="combobox"
          aria-label={strings.label}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listboxId}
          {...(activeId ? { 'aria-activedescendant': activeId } : {})}
          autoComplete="off"
          spellCheck={false}
          maxLength={SEARCH_QUERY_MAX}
          placeholder={strings.placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
            setDismissed(false);
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          leading={<IconSearch size={18} />}
          trailing={
            <kbd
              title={strings.shortcutHint}
              className="rounded-sm border border-line bg-canvas px-1.5 font-mono text-label text-ink-muted"
            >
              /
            </kbd>
          }
        />
      </form>
      <div
        hidden={!expanded}
        // Keep focus in the input while the pointer picks an option.
        onMouseDown={(event) => event.preventDefault()}
        className="absolute inset-x-0 top-full z-(--nth-z-popover) mt-1 max-h-[min(70vh,28rem)] overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-overlay"
      >
        {message === null ? null : <p className="px-3 py-2 text-label text-ink-muted">{message}</p>}
        <div
          role="listbox"
          id={listboxId}
          aria-label={strings.listLabel}
          hidden={options.length === 0}
        >
          {groups.map((group) => {
            const rows = group.hits.map((hit) => {
              const at = index;
              index += 1;
              return (
                <SearchOption
                  key={`${group.key}:${hit.exchange}:${hit.symbol}`}
                  id={optionId(at)}
                  hit={hit}
                  query={group.key === 'results' ? debounced : ''}
                  selected={at === activeIndex}
                  onChoose={() => choose(hit)}
                  onHover={() => setActive(at)}
                />
              );
            });
            if (group.title === null) return rows;
            const headingId = `${id}-${group.key}`;
            return (
              <div key={group.key} role="group" aria-labelledby={headingId}>
                <div
                  id={headingId}
                  className="px-3 pt-2 pb-1 text-label font-semibold text-ink-muted"
                >
                  {group.title}
                </div>
                {rows}
              </div>
            );
          })}
        </div>
      </div>
      <p role="status" className="sr-only">
        {listening ? announcement : ''}
      </p>
    </div>
  );
}

import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef } from 'react';
import { StoryProviders } from '@/mocks/storyMarket';
import { SearchBox } from './SearchBox';

/** Focuses the box on mount and, when given, types a query the way a user would. */
function Demo({ focus = false, query }: { focus?: boolean; query?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input || !focus) return;
    input.focus();
    if (query === undefined) return;
    // React tracks the value itself, so set it through the native setter and fire an input event.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, [focus, query]);
  return (
    <StoryProviders>
      <div className="h-[520px] w-80 bg-surface p-4">
        <SearchBox ref={ref} />
      </div>
    </StoryProviders>
  );
}

const meta = { title: 'Search/SearchBox', component: Demo } satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The left-rail search at rest. Press / in the app to focus it. */
export const Default: Story = {};

/** Focused and empty: recent searches (none yet in a fresh browser), then popular searches. */
export const Suggestions: Story = { args: { focus: true } };

/** Typing "tata": symbol, name and exchange, with the matched parts marked. ↑/↓ and Enter pick. */
export const Results: Story = { args: { focus: true, query: 'tata' } };

/** Nothing matches the query. */
export const NoResults: Story = { args: { focus: true, query: 'zzqqxx' } };

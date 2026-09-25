import { IconSearch, Input } from '@nthstock/ui';
import type { Ref } from 'react';
import { strings } from '../strings';

export type SearchBoxProps = {
  ref: Ref<HTMLInputElement>;
};

/** Search slot of the left rail. Results arrive with the search feature (E4, T-047). */
export function SearchBox({ ref }: SearchBoxProps) {
  return (
    <form role="search" className="min-w-0 flex-1" onSubmit={(event) => event.preventDefault()}>
      <Input
        ref={ref}
        type="search"
        aria-label={strings.label}
        placeholder={strings.placeholder}
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
  );
}

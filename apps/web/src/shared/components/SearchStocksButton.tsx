import { Button, IconSearch } from '@nthstock/ui';
import { useSearchFocusStore } from '@/shared/lib/searchFocusStore';

export type SearchStocksButtonProps = {
  label: string;
};

/**
 * The call to action of an empty orders, positions or holdings list (T-153): opens stock search
 * in the shell, where a result can be traded or added to the watchlist.
 */
export function SearchStocksButton({ label }: SearchStocksButtonProps) {
  const requestSearch = useSearchFocusStore((s) => s.requestSearch);
  return (
    <Button size="sm" icon={<IconSearch size={16} />} onClick={requestSearch}>
      {label}
    </Button>
  );
}

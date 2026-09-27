import type { Holding } from '@nthstock/contracts';
import { Table, TableBody, TableHead, TableHeader, TableRow, cn } from '@nthstock/ui';
import {
  HOLDINGS_SORT_KEYS,
  nextHoldingsSort,
  sortHoldings,
  type HoldingsSort,
  type HoldingsSortKey,
} from '../model/holdingsSort';
import { holdingKey } from '../model/liveHoldings';
import { strings } from '../strings';
import { HoldingRow } from './HoldingRow';

export type HoldingsTableProps = {
  /** Holdings at live prices (the live selector's rows). */
  rows: readonly Holding[];
  sort: HoldingsSort;
  onSortChange: (sort: HoldingsSort) => void;
};

/**
 * The holdings table (T-151) with a sort button in every column header. The sorted column says so
 * with `aria-sort` and an ▲▼ arrow; the order follows the live values.
 */
export function HoldingsTable({ rows, sort, onSortChange }: HoldingsTableProps) {
  const sorted = sortHoldings(rows, sort);
  const ariaSort = (key: HoldingsSortKey) =>
    sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <Table aria-label={strings.tableLabel}>
      <TableHeader>
        <TableRow>
          {HOLDINGS_SORT_KEYS.map((key) => {
            const numeric = key !== 'symbol';
            const active = sort.key === key;
            return (
              <TableHead key={key} numeric={numeric} aria-sort={ariaSort(key)}>
                <button
                  type="button"
                  onClick={() => onSortChange(nextHoldingsSort(sort, key))}
                  aria-label={strings.sortBy(strings.columns[key])}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-sm font-semibold whitespace-nowrap hover:text-ink',
                    active && 'text-ink',
                  )}
                >
                  {strings.columns[key]}
                  <span aria-hidden="true" className={cn(!active && 'invisible')}>
                    {sort.dir === 'asc' ? '▲' : '▼'}
                  </span>
                </button>
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((holding) => (
          <HoldingRow key={holdingKey(holding)} holding={holding} />
        ))}
      </TableBody>
    </Table>
  );
}

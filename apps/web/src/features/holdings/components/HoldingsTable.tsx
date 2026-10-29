import type { Holding } from '@nthstock/contracts';
import { Table, TableBody, TableHead, TableHeader, TableRow, cn } from '@nthstock/ui';
import {
  HOLDINGS_SORT_KEYS,
  nextHoldingsSort,
  sortHoldings,
  type HoldingsSort,
  type HoldingsSortKey,
} from '../model/holdingsSort';
import { useId } from 'react';
import { usePhoneLayout } from '@/shared/hooks/usePhoneLayout';
import { holdingKey } from '../model/liveHoldings';
import { strings } from '../strings';
import { HoldingCard, HoldingRow } from './HoldingRow';

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
  const phone = usePhoneLayout();
  const sortId = useId();
  if (phone) {
    // A list of three-line rows (NSTOCK-0447), as Orders has; the column sort becomes one picker,
    // A to Z for the stock and largest first for every number.
    return (
      <div className="grid gap-2">
        <div className="flex items-center justify-end gap-2 px-4 pt-3 text-label text-ink-muted">
          <label htmlFor={sortId}>{strings.phone.sort}</label>
          <select
            id={sortId}
            value={sort.key}
            onChange={(event) => {
              const key = event.target.value as HoldingsSortKey;
              onSortChange({ key, dir: key === 'symbol' ? 'asc' : 'desc' });
            }}
            className="min-h-11 rounded-md border border-line bg-surface px-2 text-body text-ink"
          >
            {HOLDINGS_SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {strings.columns[key]}
              </option>
            ))}
          </select>
        </div>
        <ul
          aria-label={strings.tableLabel}
          className="grid grid-cols-[minmax(0,1fr)] divide-y divide-line"
          data-layout="phone"
        >
          {sorted.map((holding) => (
            <HoldingCard key={holdingKey(holding)} holding={holding} />
          ))}
        </ul>
      </div>
    );
  }
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

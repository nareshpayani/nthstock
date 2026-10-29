import type { Position } from '@nthstock/contracts';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@nthstock/ui';
import { usePhoneLayout } from '@/shared/hooks/usePhoneLayout';
import { positionKey } from '../model/livePnl';
import { strings } from '../strings';
import { PositionCard, PositionRow } from './PositionRow';

const COLUMNS = [
  { key: 'product', numeric: false },
  { key: 'stock', numeric: false },
  { key: 'qty', numeric: true },
  { key: 'avg', numeric: true },
  { key: 'ltp', numeric: true },
  { key: 'pnl', numeric: true },
  { key: 'actions', numeric: false },
] as const;

/**
 * Today's positions (T-149): one memoised row each, so a tick re-renders only its cells. On a
 * phone, a list of three-line rows instead (NSTOCK-0447), as Orders has.
 */
export function PositionsTable({ positions }: { positions: readonly Position[] }) {
  const phone = usePhoneLayout();
  if (phone) {
    return (
      <ul
        aria-label={strings.tableLabel}
        className="grid grid-cols-[minmax(0,1fr)] divide-y divide-line"
        data-layout="phone"
      >
        {positions.map((position) => (
          <PositionCard key={positionKey(position)} position={position} />
        ))}
      </ul>
    );
  }
  return (
    <Table aria-label={strings.tableLabel}>
      <TableHeader>
        <TableRow>
          {COLUMNS.map((column) => (
            <TableHead key={column.key} numeric={column.numeric}>
              {strings.columns[column.key]}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => (
          <PositionRow key={positionKey(position)} position={position} />
        ))}
      </TableBody>
    </Table>
  );
}

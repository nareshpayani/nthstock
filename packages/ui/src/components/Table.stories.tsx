import type { Meta, StoryObj } from '@storybook/react-vite';
import { formatInr } from '@nthstock/utils';
import { ChangeBadge } from './ChangeBadge.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table.js';
import { VirtualCell, VirtualHeaderCell, VirtualList } from './VirtualList.js';

const meta = {
  title: 'Data/Table',
  component: Table,
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

// Sample data for the story only.
const sample = [
  { symbol: 'RELIANCE', ltp: 294110, change: 112 },
  { symbol: 'INFY', ltp: 184235, change: -48 },
  { symbol: 'HDFCBANK', ltp: 170500, change: 0 },
  { symbol: 'TATAMOTORS', ltp: 96845, change: 207 },
];

export const Basic: Story = {
  render: () => (
    <div className="max-w-lg rounded-lg border border-line bg-surface">
      <Table aria-label="Sample watchlist">
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead numeric>LTP</TableHead>
            <TableHead numeric>Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sample.map((row) => (
            <TableRow key={row.symbol}>
              <TableCell className="font-semibold">{row.symbol}</TableCell>
              <TableCell numeric>{formatInr(row.ltp)}</TableCell>
              <TableCell numeric>
                <ChangeBadge basisPoints={row.change} size="sm" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};

const rows = Array.from({ length: 5000 }, (_, index) => ({
  symbol: `STOCK${String(index + 1).padStart(4, '0')}`,
  ltp: 10000 + ((index * 7919) % 500000),
  change: ((index * 37) % 801) - 400,
}));

export const VirtualFiveThousandRows: Story = {
  name: 'VirtualList (5,000 rows)',
  render: () => (
    <VirtualList
      items={rows}
      label="All stocks (sample)"
      rowHeight={40}
      height={400}
      columns="1fr 140px 120px"
      getKey={(row) => row.symbol}
      className="max-w-lg"
      header={
        <>
          <VirtualHeaderCell>Symbol</VirtualHeaderCell>
          <VirtualHeaderCell numeric>LTP</VirtualHeaderCell>
          <VirtualHeaderCell numeric>Change</VirtualHeaderCell>
        </>
      }
      renderRow={(row) => (
        <>
          <VirtualCell className="font-semibold">{row.symbol}</VirtualCell>
          <VirtualCell numeric>{formatInr(row.ltp)}</VirtualCell>
          <VirtualCell numeric>
            <ChangeBadge basisPoints={row.change} size="sm" />
          </VirtualCell>
        </>
      )}
    />
  ),
};

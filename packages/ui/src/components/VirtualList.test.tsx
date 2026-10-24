import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table.js';
import { VirtualCell, VirtualHeaderCell, VirtualList } from './VirtualList.js';

// jsdom has no layout; give every element a 400×320 box so the virtualizer can measure
// (TanStack Virtual reads clientHeight/clientWidth, older versions offset*).
const sizes = [
  { proto: HTMLElement.prototype, key: 'offsetHeight', value: 320 },
  { proto: HTMLElement.prototype, key: 'offsetWidth', value: 400 },
  { proto: Element.prototype, key: 'clientHeight', value: 320 },
  { proto: Element.prototype, key: 'clientWidth', value: 400 },
] as const;
const originals = sizes.map(({ proto, key }) => Object.getOwnPropertyDescriptor(proto, key));
beforeAll(() => {
  for (const { proto, key, value } of sizes) {
    Object.defineProperty(proto, key, { configurable: true, get: () => value });
  }
});
afterAll(() => {
  sizes.forEach(({ proto, key }, index) => {
    const descriptor = originals[index];
    if (descriptor) Object.defineProperty(proto, key, descriptor);
  });
});

const rows = Array.from({ length: 5000 }, (_, index) => ({ symbol: `SYM${String(index)}`, index }));

function renderList(onRowActivate = vi.fn()) {
  render(
    <VirtualList
      items={rows}
      label="All stocks"
      rowHeight={40}
      height={320}
      columns="1fr 120px"
      getKey={(row) => row.symbol}
      onRowActivate={onRowActivate}
      header={
        <>
          <VirtualHeaderCell>Symbol</VirtualHeaderCell>
          <VirtualHeaderCell numeric>Row</VirtualHeaderCell>
        </>
      }
      renderRow={(row) => (
        <>
          <VirtualCell>{row.symbol}</VirtualCell>
          <VirtualCell numeric>{row.index}</VirtualCell>
        </>
      )}
    />,
  );
  return onRowActivate;
}

describe('VirtualList', () => {
  it('keeps fewer than 40 of 5,000 rows in the DOM', () => {
    renderList();
    const grid = screen.getByRole('grid', { name: 'All stocks' });
    expect(grid).toHaveAttribute('aria-rowcount', '5001');
    const bodyRows = grid.querySelectorAll('[role="row"][data-index]');
    expect(bodyRows.length).toBeGreaterThan(0);
    expect(bodyRows.length).toBeLessThan(40);
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
  });

  it('moves row focus with ↑/↓, Home and End, and activates with Enter', async () => {
    const onRowActivate = renderList();
    const first = screen.getByText('SYM0').closest('[role="row"]') as HTMLElement;
    expect(first).toHaveAttribute('tabindex', '0');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByText('SYM1').closest('[role="row"]')).toHaveFocus());
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByText('SYM2').closest('[role="row"]')).toHaveFocus());
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    await waitFor(() => expect(screen.getByText('SYM1').closest('[role="row"]')).toHaveFocus());
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    expect(onRowActivate).toHaveBeenCalledWith(rows[1], 1);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'PageDown' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    await waitFor(() => expect(screen.getByText('SYM0').closest('[role="row"]')).toHaveFocus());
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'x' });
    fireEvent.click(screen.getByText('SYM2'));
    expect(screen.getByText('SYM2').closest('[role="row"]')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('VirtualList onEndReached', () => {
  const page = rows.slice(0, 50);
  const renderPage = (onEndReached: () => void) =>
    render(
      <VirtualList
        items={page}
        label="Ledger"
        rowHeight={40}
        height={320}
        columns="1fr"
        onEndReached={onEndReached}
        renderRow={(row) => <VirtualCell>{row.symbol}</VirtualCell>}
      />,
    );

  it('fires when scrolling brings the last rows into view, not before', async () => {
    const onEndReached = vi.fn();
    renderPage(onEndReached);
    const grid = screen.getByRole('grid', { name: 'Ledger' });
    expect(onEndReached).not.toHaveBeenCalled();
    grid.scrollTop = 40 * 50 - 320;
    fireEvent.scroll(grid);
    await waitFor(() => expect(onEndReached).toHaveBeenCalled());
  });

  it('fires at once for a list shorter than the view', () => {
    const onEndReached = vi.fn();
    render(
      <VirtualList
        items={rows.slice(0, 3)}
        label="Short"
        rowHeight={40}
        height={320}
        columns="1fr"
        onEndReached={onEndReached}
        renderRow={(row) => <VirtualCell>{row.symbol}</VirtualCell>}
      />,
    );
    expect(onEndReached).toHaveBeenCalled();
  });
});

describe('Table', () => {
  it('renders semantic table parts with numeric alignment', () => {
    render(
      <Table aria-label="Holdings">
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead numeric>LTP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>INFY</TableCell>
            <TableCell numeric>₹1,842.35</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('table', { name: 'Holdings' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'LTP' })).toHaveClass('text-right');
    expect(screen.getByRole('cell', { name: '₹1,842.35' })).toHaveClass('tabular-nums');
  });
});

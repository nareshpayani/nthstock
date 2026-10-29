import type { Candle } from '@nthstock/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installResizeObserver } from '@/test/resizeObserver';
import { drawingsStorageKey, useDrawings } from '../model/drawingsStore';
import { ChartWorkspace } from './ChartWorkspace';
import { DrawingLayer } from './DrawingLayer';
import type { ChartHandle } from './PriceChartCanvas';
import { ToolRail } from './ToolRail';

const T0 = Date.parse('2026-10-28T04:00:00Z') / 1000;
const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
  t: new Date((T0 + i * 60) * 1000).toISOString(),
  o: 150_000,
  h: 151_000,
  l: 149_000,
  c: 150_500,
  v: 100,
}));

/** A chart where bar i sits at x = 10 i and y = (160,000 - price) / 50, like the shared mock. */
function fakeHandle() {
  const setVisibleLogicalRange = vi.fn();
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 400 });
  const handle = {
    host,
    chart: {
      timeScale: () => ({
        subscribeVisibleLogicalRangeChange: vi.fn(),
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
        logicalToCoordinate: (logical: number) => logical * 10,
        coordinateToLogical: (x: number) => x / 10,
        setVisibleLogicalRange,
      }),
      subscribeCrosshairMove: vi.fn(),
      unsubscribeCrosshairMove: vi.fn(),
      priceScale: () => ({ width: () => 60 }),
      paneSize: () => ({ height: 300 }),
    },
    series: {
      priceToCoordinate: (price: number) => (160_000 - price) / 50,
      coordinateToPrice: (y: number) => 160_000 - y * 50,
    },
  } as unknown as ChartHandle;
  return { handle, setVisibleLogicalRange };
}

const tap = (layer: Element, x: number, y: number) => {
  fireEvent.pointerDown(layer, { clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(layer, { clientX: x, clientY: y, pointerId: 1 });
};

const stored = () => JSON.parse(window.localStorage.getItem(drawingsStorageKey('INFY')) ?? '[]');

beforeAll(() => {
  installResizeObserver();
  Element.prototype.setPointerCapture = vi.fn();
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  window.localStorage.clear();
  useDrawings.setState({ tool: null, magnet: false, bySymbol: {}, cleared: {} });
});

function renderTools() {
  const { handle, setVisibleLogicalRange } = fakeHandle();
  render(
    <div>
      <ToolRail symbol="INFY" />
      <DrawingLayer handle={handle} candles={candles} symbol="INFY" format="inr" />
    </div>,
  );
  return { layer: screen.getByTestId('drawing-layer'), setVisibleLogicalRange };
}

describe('drawing tools (NSTOCK-0461)', () => {
  it('lets touches through to the chart until a tool is picked', () => {
    const { layer } = renderTools();
    expect(layer).toHaveStyle({ pointerEvents: 'none' });
    fireEvent.click(screen.getByRole('button', { name: 'Trend line' }));
    expect(layer).toHaveStyle({ pointerEvents: 'auto' });
    expect(screen.getByRole('status')).toHaveTextContent(/Tap the start, then the end/);
  });

  it('draws a trend line with two taps and saves it for the symbol', () => {
    const { layer } = renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'Trend line' }));
    tap(layer, 50, 100);
    expect(stored()).toEqual([]);
    tap(layer, 150, 40);
    expect(stored()).toEqual([
      {
        id: expect.any(String),
        kind: 'trend',
        from: { time: T0 + 5 * 60, price: 155_000 },
        to: { time: T0 + 15 * 60, price: 158_000 },
      },
    ]);
    // Back to the crosshair after one drawing.
    expect(screen.getByRole('button', { name: /^Crosshair/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('draws a horizontal line with one tap, snapping to the bar with the magnet', () => {
    const { layer } = renderTools();
    fireEvent.click(screen.getByRole('button', { name: /^Magnet/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal line' }));
    // 150,600 is nearest the bar's close of 150,500.
    tap(layer, 52, (160_000 - 150_600) / 50);
    expect(stored()[0]).toMatchObject({ kind: 'horizontal', at: { price: 150_500 } });
  });

  it('undoes, clears and brings a clear back with undo', () => {
    const { layer } = renderTools();
    for (const x of [50, 80]) {
      fireEvent.click(screen.getByRole('button', { name: 'Horizontal line' }));
      tap(layer, x, 100);
    }
    expect(stored()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Undo last drawing' }));
    expect(stored()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all drawings' }));
    expect(stored()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo last drawing' }));
    expect(stored()).toHaveLength(1);
  });

  it('zooms the time axis to a dragged span and leaves nothing behind', () => {
    const { layer, setVisibleLogicalRange } = renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to an area' }));
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 150, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 150, clientY: 100, pointerId: 1 });
    expect(setVisibleLogicalRange).toHaveBeenCalledWith({ from: 5, to: 15 });
    expect(stored()).toEqual([]);
  });

  it('measures between two taps and shows the change', () => {
    const { layer } = renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    tap(layer, 50, 200);
    tap(layer, 150, 100);
    expect(screen.getByTestId('measure-box')).toHaveTextContent('+50.00 (▲ 3.33%) · 10 bars · 10m');
    fireEvent.click(screen.getByRole('button', { name: 'Clear measure' }));
    expect(screen.queryByTestId('measure-box')).not.toBeInTheDocument();
  });

  it('Escape puts a picked tool down', () => {
    renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'Ray' }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(useDrawings.getState().tool).toBeNull();
  });
});

describe('full-screen chart (NSTOCK-0461)', () => {
  it('opens as a dialog with the rail, and Escape or Close leave it', () => {
    const onClose = vi.fn();
    render(
      <ChartWorkspace name="INFY" symbol="INFY" controls={null} footer={null} onClose={onClose}>
        {() => <p>plot</p>}
      </ChartWorkspace>,
    );
    expect(screen.getByRole('dialog', { name: 'INFY chart' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Drawing tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close full screen' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close full screen' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a first Escape drops a picked tool instead of closing', () => {
    const onClose = vi.fn();
    render(
      <ChartWorkspace name="INFY" symbol="INFY" controls={null} footer={null} onClose={onClose}>
        {() => null}
      </ChartWorkspace>,
    );
    act(() => useDrawings.getState().setTool('trend'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

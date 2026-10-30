import type { Candle } from '@nthstock/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
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

const stored = () => JSON.parse(window.localStorage.getItem(drawingsStorageKey('INFY')) ?? '[]');

let resizer: ReturnType<typeof installResizeObserver>;
beforeAll(() => {
  resizer = installResizeObserver();
  Element.prototype.setPointerCapture = vi.fn();
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  window.localStorage.clear();
  useDrawings.setState({ tool: null, magnet: false, bySymbol: {}, cleared: {}, unsaved: {} });
});

function renderTools(symbol = 'INFY') {
  const { handle, setVisibleLogicalRange } = fakeHandle();
  render(
    <div>
      <ToolRail symbol={symbol} />
      <DrawingLayer handle={handle} candles={candles} symbol={symbol} format="inr" />
    </div>,
  );
  return { layer: screen.getByTestId('drawing-layer'), setVisibleLogicalRange };
}

/** An Escape the way a browser sends it: cancelable, so a handler can claim it. */
const escape = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  });

/** The full-screen chart with the drawing layer inside, as the cards render it. */
function renderWorkspace(onClose: () => void, controls: ReactNode = null) {
  const { handle } = fakeHandle();
  render(
    <ChartWorkspace name="INFY" symbol="INFY" controls={controls} footer={null} onClose={onClose}>
      {() => <DrawingLayer handle={handle} candles={candles} symbol="INFY" format="inr" />}
    </ChartWorkspace>,
  );
  // The plot is drawn once the box below the header has a height.
  act(() => resizer.resize(400, 300));
}

const keyboardSurface = () => screen.getByRole('application', { name: /^Chart plot/ });
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(keyboardSurface(), { key, ...init });
const said = () => screen.getByTestId('keyboard-readout').textContent ?? '';

/** Picks a tool on the rail and moves focus to the plot, as Tab from the rail would. */
function pickAndFocus(tool: string) {
  fireEvent.click(screen.getByRole('button', { name: tool }));
  act(() => keyboardSurface().focus());
}

describe('placing drawings from the keyboard (NSTOCK-0468)', () => {
  it('has no plot stop until a tool is picked', () => {
    renderTools();
    expect(screen.queryByRole('application')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Trend line' }));
    expect(keyboardSurface()).toHaveAttribute('tabindex', '0');
    expect(keyboardSurface()).toHaveAccessibleName('Chart plot: Trend line');
    expect(keyboardSurface()).toHaveAccessibleDescription(/Arrow keys move the point/);
  });

  it('starts on the last bar at its close and says where the point is', () => {
    renderTools();
    pickAndFocus('Horizontal line');
    expect(said()).toMatch(/₹1,505\.00$/);
    expect(screen.getByTestId('keyboard-point')).toBeInTheDocument();
  });

  it('places a horizontal line with Enter, a price step up from the close', () => {
    renderTools();
    pickAndFocus('Horizontal line');
    // The plot shows 160,000 to 145,000 paise: a step is ₹5.00.
    press('ArrowUp');
    expect(said()).toMatch(/₹1,510\.00$/);
    press('Enter');
    expect(stored()).toEqual([
      { id: expect.any(String), kind: 'horizontal', at: { time: T0 + 29 * 60, price: 151_000 } },
    ]);
    expect(said()).toBe('Horizontal line placed');
    // Focus stays on the plot, now a plain stop, so Tab goes on from here.
    expect(keyboardSurface()).toHaveFocus();
    expect(keyboardSurface()).toHaveAccessibleName('Chart plot');
  });

  it('draws a trend line with two Enters, moving by bars and Shift for ten', () => {
    renderTools();
    pickAndFocus('Trend line');
    press('ArrowLeft', { shiftKey: true });
    press('ArrowLeft', { shiftKey: true });
    press('Enter');
    expect(said()).toMatch(/^Start placed at .*₹1,505\.00\. Move to the end/);
    expect(stored()).toEqual([]);
    press('ArrowRight', { shiftKey: true });
    press('ArrowDown', { shiftKey: true });
    press('Enter');
    expect(stored()).toEqual([
      {
        id: expect.any(String),
        kind: 'trend',
        from: { time: T0 + 9 * 60, price: 150_500 },
        to: { time: T0 + 19 * 60, price: 145_500 },
      },
    ]);
    expect(said()).toBe('Trend line placed');
  });

  it('keeps the point within the bars and goes to either end with Home and End', () => {
    renderTools();
    pickAndFocus('Ray');
    press('ArrowRight', { shiftKey: true });
    press('Enter');
    press('Home');
    press('Enter');
    expect(stored()[0]).toMatchObject({
      kind: 'ray',
      from: { time: T0 + 29 * 60 },
      to: { time: T0 },
    });
  });

  it('places Fibonacci levels and measures by keyboard', () => {
    renderTools();
    pickAndFocus('Fibonacci retracement');
    press('Enter');
    press('ArrowDown');
    press('Enter');
    expect(stored()[0]).toMatchObject({ kind: 'fib' });
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    act(() => keyboardSurface().focus());
    press('Enter');
    press('ArrowLeft');
    press('Enter');
    expect(screen.getByTestId('measure-readout')).toHaveTextContent(/1 bars/);
  });

  it('zooms to the bars between two Enters', () => {
    const { setVisibleLogicalRange } = renderTools();
    pickAndFocus('Zoom to an area');
    press('Enter');
    press('Home');
    press('Enter');
    expect(setVisibleLogicalRange).toHaveBeenCalledWith({ from: 0, to: 29 });
  });

  it('says so and keeps the zoom tool when the two points are under two bars apart', () => {
    const { setVisibleLogicalRange } = renderTools();
    pickAndFocus('Zoom to an area');
    press('Enter');
    press('Enter');
    expect(setVisibleLogicalRange).not.toHaveBeenCalled();
    expect(useDrawings.getState().tool).toBe('zoom');
    expect(screen.getByTestId('keyboard-readout')).toHaveTextContent(/too close/);
  });

  it('opens a note box at the point and returns focus to the plot after it', () => {
    renderTools();
    pickAndFocus('Text note');
    press('Enter');
    const box = screen.getByRole('textbox', { name: 'Note text' });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: 'Support' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(stored()[0]).toMatchObject({ kind: 'text', text: 'Support' });
    expect(keyboardSurface()).toHaveFocus();
  });

  it('snaps the point to the bar with the magnet on', () => {
    useDrawings.setState({ magnet: true });
    renderTools();
    pickAndFocus('Horizontal line');
    press('ArrowUp');
    press('ArrowUp');
    press('Enter');
    // ₹1,515.00 snaps to the bar's high, ₹1,510.00.
    expect(stored()[0]).toMatchObject({ at: { price: 151_000 } });
  });

  it('leaves the arrows to the page when no tool is picked', () => {
    renderTools();
    pickAndFocus('Horizontal line');
    press('Enter');
    expect(fireEvent.keyDown(keyboardSurface(), { key: 'ArrowUp' })).toBe(true);
    expect(stored()).toHaveLength(1);
  });

  it('lists the drawings in the rail and removes one by keyboard', async () => {
    renderTools();
    const list = screen.getByRole('button', { name: 'Drawings on this chart (0)' });
    expect(list).toBeEnabled();
    pickAndFocus('Horizontal line');
    press('Enter');
    pickAndFocus('Trend line');
    press('Enter');
    press('ArrowLeft');
    press('Enter');
    const trigger = screen.getByRole('button', { name: 'Drawings on this chart (2)' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Remove Horizontal line, ₹1,505.00',
      'Remove Trend line, ₹1,505.00 to ₹1,505.00',
    ]);
    fireEvent.click(items[0] as HTMLElement);
    expect(stored()).toEqual([expect.objectContaining({ kind: 'trend' })]);
    expect(screen.getByText('Removed Horizontal line, ₹1,505.00')).toBeInTheDocument();
  });

  it('says there are no drawings when the list is opened empty', async () => {
    renderTools();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drawings on this chart (0)' }), {
      key: 'Enter',
    });
    expect(await screen.findByRole('menuitem', { name: 'No drawings yet' })).toBeInTheDocument();
  });

  it('keeps the drawings button enabled after the last drawing is removed, so focus has a home', async () => {
    renderTools();
    pickAndFocus('Horizontal line');
    press('Enter');
    const trigger = screen.getByRole('button', { name: 'Drawings on this chart (1)' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem'));
    const empty = screen.getByRole('button', { name: 'Drawings on this chart (0)' });
    expect(empty).toBeEnabled();
    await waitFor(() => expect(document.body).not.toBe(document.activeElement));
  });

  it('names index levels in points on the index chart', async () => {
    const { handle } = fakeHandle();
    render(
      <div>
        <ToolRail symbol="NIFTY" format="index" />
        <DrawingLayer handle={handle} candles={candles} symbol="NIFTY" format="index" />
      </div>,
    );
    pickAndFocus('Horizontal line');
    press('Enter');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drawings on this chart (1)' }), {
      key: 'Enter',
    });
    expect((await screen.findByRole('menuitem')).textContent).not.toContain('₹');
  });

  it('drops the tool with Escape on the plot in the full-screen chart, then closes', () => {
    const onClose = vi.fn();
    renderWorkspace(onClose);
    pickAndFocus('Trend line');
    press('Enter');
    escape();
    expect(useDrawings.getState().tool).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    escape();
    expect(onClose).toHaveBeenCalled();
  });
});

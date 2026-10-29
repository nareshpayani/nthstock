import type { Candle } from '@nthstock/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { colors } from '@nthstock/tokens';
import { ToastProvider, useToast } from '@nthstock/ui';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installResizeObserver } from '@/test/resizeObserver';
import { drawingsStorageKey, unreadableDrawingsKey, useDrawings } from '../model/drawingsStore';
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

describe('drawing tools (NSTOCK-0461)', () => {
  it('lets touches through to the chart until a tool is picked', () => {
    const { layer } = renderTools();
    expect(layer).toHaveStyle({ pointerEvents: 'none' });
    fireEvent.click(screen.getByRole('button', { name: 'Trend line' }));
    expect(layer).toHaveStyle({ pointerEvents: 'auto' });
    expect(
      screen
        .getAllByRole('status')
        .some((line) => /Tap the start, then the end/.test(line.textContent ?? '')),
    ).toBe(true);
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

  it('draws a trend line with one drag from the first point to the second', () => {
    const { layer } = renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'Trend line' }));
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 150, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 150, clientY: 40, pointerId: 1 });
    expect(stored()).toEqual([
      expect.objectContaining({
        kind: 'trend',
        from: { time: T0 + 5 * 60, price: 155_000 },
        to: { time: T0 + 15 * 60, price: 158_000 },
      }),
    ]);
    // Ink, not brand blue: blue is for actions and the Buy order lines.
    expect(layer.querySelector('line')).toHaveAttribute('stroke', colors.ink);
  });

  it('draws a ray on to the plot edge, and Fibonacci levels between two taps', () => {
    const { layer } = renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'Ray' }));
    tap(layer, 50, 100);
    tap(layer, 100, 80);
    fireEvent.click(screen.getByRole('button', { name: 'Fibonacci retracement' }));
    tap(layer, 50, 200);
    tap(layer, 150, 100);
    expect(stored().map((drawing: { kind: string }) => drawing.kind)).toEqual(['ray', 'fib']);
    // The ray runs past its second point to the right edge of the 340 px plot.
    expect(layer.querySelector('line')).toHaveAttribute('x2', '340');
    expect(layer).toHaveTextContent('0.618');
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

  it('a zoom across fewer than two bars changes nothing', () => {
    const { layer, setVisibleLogicalRange } = renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to an area' }));
    fireEvent.pointerDown(layer, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 60, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 60, clientY: 100, pointerId: 1 });
    expect(setVisibleLogicalRange).not.toHaveBeenCalled();
  });

  it('a right click is not a point', () => {
    const { layer } = renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal line' }));
    fireEvent.pointerDown(layer, {
      clientX: 50,
      clientY: 100,
      pointerId: 1,
      button: 2,
      pointerType: 'mouse',
    });
    fireEvent.pointerUp(layer, {
      clientX: 50,
      clientY: 100,
      pointerId: 1,
      button: 2,
      pointerType: 'mouse',
    });
    expect(stored()).toEqual([]);
    expect(useDrawings.getState().tool).toBe('horizontal');
  });

  it('an Escape in an open menu keeps the picked tool', () => {
    renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'Ray' }));
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.append(menu);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(useDrawings.getState().tool).toBe('ray');
    menu.remove();
  });

  it('measures between two taps and shows the change', () => {
    const { layer } = renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    tap(layer, 50, 200);
    tap(layer, 150, 100);
    expect(screen.getByTestId('measure-box')).toHaveTextContent('+50.00 (▲ 3.33%) · 10 bars · 10m');
    // The SVG is hidden from screen readers; the same numbers are announced.
    expect(screen.getByTestId('measure-readout')).toHaveTextContent('+50.00 (▲ 3.33%) · 10 bars');
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

  it('a first Escape drops a picked tool, with the drawing layer listening too; the next closes', () => {
    const onClose = vi.fn();
    renderWorkspace(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Trend line' }));
    expect(screen.getByTestId('drawing-layer')).toHaveAttribute('data-tool', 'trend');
    escape();
    expect(useDrawings.getState().tool).toBeNull();
    expect(screen.getByTestId('drawing-layer')).not.toHaveAttribute('data-tool');
    expect(onClose).not.toHaveBeenCalled();
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to a text field or an open menu inside it', () => {
    const onClose = vi.fn();
    renderWorkspace(
      onClose,
      <>
        <input aria-label="Search" />
        <button type="button" aria-expanded="true">
          Indicators
        </button>
      </>,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Indicators' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('on close gives focus back to the opener, restores scrolling and puts the tool down', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    const openerRef = { current: opener };
    const view = render(
      <ChartWorkspace
        name="INFY"
        symbol="INFY"
        controls={null}
        footer={null}
        onClose={vi.fn()}
        opener={openerRef}
      >
        {() => null}
      </ChartWorkspace>,
    );
    act(() => useDrawings.getState().setTool('trend'));
    view.unmount();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
    expect(useDrawings.getState().tool).toBeNull();
    opener.remove();
  });

  it('leaves an element that was inert before it opened inert after it closes', () => {
    const already = document.createElement('aside');
    already.setAttribute('inert', '');
    document.body.append(already);
    const view = render(
      <ChartWorkspace name="INFY" symbol="INFY" controls={null} footer={null} onClose={vi.fn()}>
        {() => null}
      </ChartWorkspace>,
    );
    view.unmount();
    expect(already).toHaveAttribute('inert');
    already.remove();
  });

  it('leaves a toast raised while full screen usable, with the page beside it inert', () => {
    let toast: ReturnType<typeof useToast> | undefined;
    function Raiser() {
      toast = useToast();
      return <main data-testid="page">page</main>;
    }
    const view = render(
      <ToastProvider>
        <Raiser />
        <ChartWorkspace name="INFY" symbol="INFY" controls={null} footer={null} onClose={vi.fn()}>
          {() => null}
        </ChartWorkspace>
      </ToastProvider>,
    );
    act(() => toast?.show({ title: 'Order filled' }));
    // The workspace keeps whatever carries this mark usable; the toast viewport must carry it.
    expect(document.querySelector('[data-nth-toasts]')).not.toBeNull();
    expect(screen.getByTestId('page')).toHaveAttribute('inert');
    expect(screen.getByText('Order filled').closest('[inert]')).toBeNull();
    view.unmount();
  });

  it('makes the page behind inert while open, and gives it back on close', () => {
    const page = document.createElement('main');
    document.body.append(page);
    const view = render(
      <ChartWorkspace name="INFY" symbol="INFY" controls={null} footer={null} onClose={vi.fn()}>
        {() => null}
      </ChartWorkspace>,
    );
    expect(page).toHaveAttribute('inert');
    expect(screen.getByRole('dialog').closest('[inert]')).toBeNull();
    view.unmount();
    expect(page).not.toHaveAttribute('inert');
    page.remove();
  });

  it('a note dropped with Escape stays dropped, and keeps the full-screen chart open', () => {
    const onClose = vi.fn();
    renderWorkspace(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Text note' }));
    tap(screen.getByTestId('drawing-layer'), 50, 100);
    const box = screen.getByRole('textbox', { name: 'Note text' });
    fireEvent.change(box, { target: { value: 'support' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    fireEvent.blur(box);
    expect(stored()).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a note saved with Enter is saved once, not again on the blur that follows', () => {
    renderWorkspace(vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Text note' }));
    tap(screen.getByTestId('drawing-layer'), 50, 100);
    const box = screen.getByRole('textbox', { name: 'Note text' });
    fireEvent.change(box, { target: { value: 'support' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.blur(box);
    expect(stored()).toEqual([expect.objectContaining({ kind: 'text', text: 'support' })]);
  });
});

describe('saved drawings (NSTOCK-0461)', () => {
  it("reads a symbol's drawings back from storage and keeps symbols apart", () => {
    window.localStorage.setItem(
      drawingsStorageKey('INFY'),
      JSON.stringify([{ id: 'a', kind: 'horizontal', at: { time: T0, price: 150_000 } }]),
    );
    const { layer } = renderTools('TCS');
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal line' }));
    tap(layer, 50, 100);
    expect(useDrawings.getState().drawingsFor('INFY')).toHaveLength(1);
    expect(useDrawings.getState().drawingsFor('TCS')).toHaveLength(1);
    expect(stored()).toHaveLength(1);
  });

  it('sets aside a stored value it cannot read, so the next drawing does not lose it', () => {
    window.localStorage.setItem(drawingsStorageKey('INFY'), '{not json');
    const { layer } = renderTools();
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal line' }));
    tap(layer, 50, 100);
    expect(window.localStorage.getItem(unreadableDrawingsKey('INFY'))).toBe('{not json');
    expect(stored()).toHaveLength(1);
  });

  it('sets aside a stored list when it drops an unreadable entry from it', () => {
    const raw = JSON.stringify([
      { id: 'bad', kind: 'trend' },
      { id: 'a', kind: 'horizontal', at: { time: T0, price: 150_000 } },
    ]);
    window.localStorage.setItem(drawingsStorageKey('INFY'), raw);
    expect(useDrawings.getState().drawingsFor('INFY')).toHaveLength(1);
    expect(window.localStorage.getItem(unreadableDrawingsKey('INFY'))).toBe(raw);
  });

  it('keeps the not-saved warning to the symbol whose save failed', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      const at = { time: T0, price: 150_000 };
      act(() => useDrawings.getState().add('INFY', { id: 'a', kind: 'horizontal', at }));
      act(() => useDrawings.getState().add('TCS', { id: 'b', kind: 'horizontal', at }));
      expect(useDrawings.getState().unsaved).toEqual({ INFY: true, TCS: false });
    } finally {
      setItem.mockRestore();
    }
  });

  it('when the unreadable value cannot be set aside, keeps it and does not save over it', () => {
    // Its own symbol: the store remembers per symbol which values it could not protect.
    window.localStorage.setItem(drawingsStorageKey('WIPRO'), '{not json');
    const setItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === unreadableDrawingsKey('WIPRO'))
        throw new DOMException('full', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    try {
      const at = { time: T0, price: 150_000 };
      act(() => useDrawings.getState().add('WIPRO', { id: 'a', kind: 'horizontal', at }));
      expect(window.localStorage.getItem(drawingsStorageKey('WIPRO'))).toBe('{not json');
      expect(useDrawings.getState().unsaved.WIPRO).toBe(true);
      expect(useDrawings.getState().drawingsFor('WIPRO')).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the first copy set aside, and will not save over a second unreadable value', () => {
    window.localStorage.setItem(unreadableDrawingsKey('HDFC'), 'first');
    window.localStorage.setItem(drawingsStorageKey('HDFC'), '{not json');
    const at = { time: T0, price: 150_000 };
    act(() => useDrawings.getState().add('HDFC', { id: 'a', kind: 'horizontal', at }));
    expect(window.localStorage.getItem(unreadableDrawingsKey('HDFC'))).toBe('first');
    expect(window.localStorage.getItem(drawingsStorageKey('HDFC'))).toBe('{not json');
    expect(useDrawings.getState().unsaved.HDFC).toBe(true);
  });

  it('shows the not-saved note on first read when a second unreadable value cannot be kept', () => {
    window.localStorage.setItem(unreadableDrawingsKey('ITC'), 'first');
    window.localStorage.setItem(drawingsStorageKey('ITC'), '{also not json');
    renderTools('ITC');
    expect(screen.getByTestId('drawings-not-saved')).toHaveTextContent("can't be saved");
  });

  it('saves over an unreadable value that is the copy already set aside', () => {
    window.localStorage.setItem(unreadableDrawingsKey('MARUTI'), '{not json');
    window.localStorage.setItem(drawingsStorageKey('MARUTI'), '{not json');
    const at = { time: T0, price: 150_000 };
    act(() => useDrawings.getState().add('MARUTI', { id: 'a', kind: 'horizontal', at }));
    const saved = JSON.parse(window.localStorage.getItem(drawingsStorageKey('MARUTI')) ?? '');
    expect(saved).toHaveLength(1);
    expect(useDrawings.getState().unsaved.MARUTI).toBe(false);
  });

  it('warns with the symbol when a second unreadable value is kept, not the value', () => {
    window.localStorage.setItem(unreadableDrawingsKey('SBIN'), 'first');
    window.localStorage.setItem(drawingsStorageKey('SBIN'), '{secret');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      useDrawings.getState().drawingsFor('SBIN');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('SBIN'));
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('secret'));
    } finally {
      warn.mockRestore();
    }
  });

  it('puts a picked tool down when the chart goes', () => {
    const { handle } = fakeHandle();
    const view = render(
      <DrawingLayer handle={handle} candles={candles} symbol="INFY" format="inr" />,
    );
    act(() => useDrawings.getState().setTool('trend'));
    view.unmount();
    expect(useDrawings.getState().tool).toBeNull();
  });

  it('a new drawing after Clear means Undo removes it, not bring the cleared ones back', () => {
    const { layer } = renderTools();
    for (const x of [50, 80]) {
      fireEvent.click(screen.getByRole('button', { name: 'Horizontal line' }));
      tap(layer, x, 100);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Clear all drawings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal line' }));
    tap(layer, 120, 100);
    fireEvent.click(screen.getByRole('button', { name: 'Undo last drawing' }));
    expect(stored()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Undo last drawing' })).toBeDisabled();
  });

  it('says so when storage refuses the drawing, instead of looking saved', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      const { layer } = renderTools();
      fireEvent.click(screen.getByRole('button', { name: 'Horizontal line' }));
      tap(layer, 50, 100);
      expect(screen.getByTestId('drawings-not-saved')).toHaveTextContent(
        "Drawings can't be saved on this device",
      );
    } finally {
      setItem.mockRestore();
    }
  });
});

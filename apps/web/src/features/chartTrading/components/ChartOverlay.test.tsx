import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartHandle } from '@/features/charts';
import { AreaSeries, chartsMock, createChart } from '@/test/chartsMock';
import type { OverlayLine } from '../model/overlayLine';
import { ChartOverlay } from './ChartOverlay';

// The fake scale: ₹1,600.00 at y = 0, 50 paise per px, a 300 px pane and a 64 px price axis.
function makeHandle(): ChartHandle {
  const host = document.createElement('div');
  document.body.append(host);
  const chart = createChart(host, {});
  const series = chart.addSeries(AreaSeries);
  return { chart, series, host } as unknown as ChartHandle;
}
const series = () => chartsMock.active().at(-1)?.series[0];

function pointer(target: Element, type: string, clientY: number, pointerId = 1, clientX = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, clientX });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
}

const line = (extra: Partial<OverlayLine> & Pick<OverlayLine, 'id' | 'price'>): OverlayLine => ({
  tone: 'buy',
  label: `Buy @ ${String(extra.price)}`,
  description: `Buy limit at ${String(extra.price)}`,
  draggable: true,
  ...extra,
});
const handleY = (id: string) =>
  Number(
    screen
      .getAllByTestId('chart-handle')
      .find((el) => el.dataset.line === id)
      ?.getAttribute('data-y'),
  );

afterEach(() => chartsMock.reset());

describe('chart overlay (T15, SPEC-TFC-1 §10.5)', () => {
  it('draws a price line and a labelled handle for each line, and removes them with it', () => {
    const handle = makeHandle();
    const { rerender, unmount } = render(
      <ChartOverlay
        handle={handle}
        tickSize={5}
        label="Chart orders for INFY"
        lines={[
          line({ id: 'o1', price: 150_000 }),
          line({ id: 'o2', price: 145_000, tone: 'sell' }),
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Chart orders for INFY' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy limit at 150000' })).toHaveTextContent(
      'Buy @ 150000',
    );
    expect(series()?.priceLines.map((l) => l.options.price)).toEqual([150_000, 145_000]);
    expect(handleY('o1')).toBe(200);
    expect(handleY('o2')).toBe(300 - 22);

    rerender(
      <ChartOverlay
        handle={handle}
        tickSize={5}
        label="Chart orders for INFY"
        lines={[line({ id: 'o1', price: 155_000 })]}
      />,
    );
    expect(series()?.priceLines.map((l) => l.options.price)).toEqual([155_000]);
    expect(handleY('o1')).toBe(100);

    unmount();
    expect(series()?.priceLines).toEqual([]);
    expect(series()?.primitives).toEqual([]);
  });

  it('keeps handles on their lines through pan, pinch and autoscale with no React render', () => {
    const handle = makeHandle();
    const onRender = vi.fn();
    render(
      <Profiler id="overlay" onRender={onRender}>
        <ChartOverlay
          handle={handle}
          tickSize={5}
          label="Chart orders"
          lines={[line({ id: 'o1', price: 150_000 })]}
        />
      </Profiler>,
    );
    const renders = onRender.mock.calls.length;
    expect(handleY('o1')).toBe(200);

    // Autoscale after a tick: the scale stretches, so the same price sits lower.
    for (let i = 1; i <= 50; i += 1) {
      chartsMock.scale.top = 160_000 + i * 20;
      chartsMock.repaint();
    }
    expect(handleY('o1')).toBe((161_000 - 150_000) / 50);
    // Pinch: twice the paise per px.
    chartsMock.scale.paisePerPx = 100;
    chartsMock.repaint();
    expect(handleY('o1')).toBe(110);
    expect(onRender.mock.calls.length).toBe(renders);
  });

  it('pins an off-screen line to the edge with an arrow', () => {
    render(
      <ChartOverlay
        handle={makeHandle()}
        tickSize={5}
        label="Chart orders"
        lines={[line({ id: 'far', price: 200_000 })]}
      />,
    );
    const handle = screen.getByTestId('chart-handle');
    expect(handle).toHaveAttribute('data-pinned', 'top');
    expect(handleY('far')).toBe(22);
  });

  it('a tap in the gutter gives a snapped price; a drag there does not', () => {
    const onGutterTap = vi.fn();
    render(
      <ChartOverlay
        handle={makeHandle()}
        tickSize={5}
        label="Chart orders"
        lines={[]}
        onGutterTap={onGutterTap}
      />,
    );
    const gutter = screen.getByTestId('chart-gutter');
    expect(gutter).toHaveStyle({ width: '64px', height: '300px' });
    pointer(gutter, 'pointerdown', 100.03);
    pointer(gutter, 'pointerup', 100.03);
    expect(onGutterTap).toHaveBeenCalledWith(155_000);
    pointer(gutter, 'pointerdown', 100);
    pointer(gutter, 'pointerup', 140);
    expect(onGutterTap).toHaveBeenCalledTimes(1);
  });

  it('a handle drag reports each price and saves once on release; a tap does not drag', () => {
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    const onHandleTap = vi.fn();
    render(
      <ChartOverlay
        handle={makeHandle()}
        tickSize={5}
        label="Chart orders"
        lines={[line({ id: 'o1', price: 150_000 })]}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onHandleTap={onHandleTap}
      />,
    );
    const handle = screen.getByTestId('chart-handle');
    pointer(handle, 'pointerdown', 200);
    pointer(handle, 'pointerup', 203);
    expect(onHandleTap).toHaveBeenCalledWith('o1');

    pointer(handle, 'pointerdown', 200);
    pointer(handle, 'pointermove', 180.02);
    pointer(handle, 'pointermove', 160);
    pointer(handle, 'pointerup', 160);
    expect(onDragMove.mock.calls).toEqual([
      ['o1', 151_000],
      ['o1', 152_000],
    ]);
    expect(onDragEnd).toHaveBeenCalledExactlyOnceWith('o1', 152_000);

    // A second finger cancels.
    pointer(handle, 'pointerdown', 200);
    pointer(handle, 'pointermove', 150);
    pointer(document.body, 'pointerdown', 50, 2);
    expect(onDragEnd).toHaveBeenLastCalledWith('o1', null);
  });

  it('moves a handle with the arrow keys, saves with Enter and restores with Escape', () => {
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    const onHandleDelete = vi.fn();
    render(
      <ChartOverlay
        handle={makeHandle()}
        tickSize={5}
        label="Chart orders"
        lines={[line({ id: 'o1', price: 150_000 })]}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onHandleDelete={onHandleDelete}
      />,
    );
    const handle = screen.getByTestId('chart-handle');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    expect(onDragMove).toHaveBeenLastCalledWith('o1', 150_055);
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(onDragEnd).toHaveBeenLastCalledWith('o1', 150_055);
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'Escape' });
    expect(onDragEnd).toHaveBeenLastCalledWith('o1', null);
    fireEvent.keyDown(handle, { key: 'Delete' });
    expect(onHandleDelete).toHaveBeenCalledWith('o1');
  });

  it('ends a drag when its line goes away mid-drag (a fill or a cancel)', () => {
    const onDragEnd = vi.fn();
    const handle = makeHandle();
    function Host() {
      const [lines, setLines] = useState([line({ id: 'o1', price: 150_000 })]);
      return (
        <>
          <button type="button" onClick={() => setLines([])}>
            fill
          </button>
          <ChartOverlay
            handle={handle}
            tickSize={5}
            label="Chart orders"
            lines={lines}
            onDragEnd={onDragEnd}
          />
        </>
      );
    }
    render(<Host />);
    const grab = screen.getByTestId('chart-handle');
    pointer(grab, 'pointerdown', 200);
    pointer(grab, 'pointermove', 150);
    act(() => screen.getByRole('button', { name: 'fill' }).click());
    expect(onDragEnd).toHaveBeenCalledExactlyOnceWith('o1', null);
  });

  it('a chip that does not move a price: a tap opens it, a drag that starts on it pans (T18, §9.1)', () => {
    const handle = makeHandle();
    const onHandleTap = vi.fn();
    const onDragMove = vi.fn();
    render(
      <ChartOverlay
        handle={handle}
        tickSize={5}
        label="Chart orders for INFY"
        lines={[line({ id: 'pos', price: 150_000, tone: 'position', draggable: false })]}
        onHandleTap={onHandleTap}
        onDragMove={onDragMove}
      />,
    );
    const chip = screen.getByTestId('chart-handle');
    const range = () => chartsMock.active().at(-1)?.logicalRange;

    pointer(chip, 'pointerdown', 200, 1, 100);
    pointer(chip, 'pointerup', 200, 1, 102);
    expect(onHandleTap).toHaveBeenCalledWith('pos');
    expect(range()).toEqual({ from: 0, to: 60 });

    // Drag right 40 px at 10 px a bar: four bars earlier, and no tap and no price move.
    onHandleTap.mockClear();
    pointer(chip, 'pointerdown', 200, 1, 100);
    pointer(chip, 'pointermove', 201, 1, 120);
    pointer(chip, 'pointermove', 202, 1, 140);
    pointer(chip, 'pointerup', 202, 1, 140);
    expect(range()).toEqual({ from: -4, to: 56 });
    expect(onHandleTap).not.toHaveBeenCalled();
    expect(onDragMove).not.toHaveBeenCalled();

    // Enter on the focused chip opens it too.
    fireEvent.keyDown(chip, { key: 'Enter' });
    expect(onHandleTap).toHaveBeenCalledWith('pos');
  });

  it('dragging an offset label moves its price by the finger, not to the label (T19, §8.4)', () => {
    const handle = makeHandle();
    const onDragMove = vi.fn();
    render(
      <ChartOverlay
        handle={handle}
        tickSize={5}
        label="Chart orders for INFY"
        lines={[
          line({ id: 'o1', price: 150_000 }),
          line({ id: 'o2', price: 149_500, tone: 'sell' }),
        ]}
        onDragMove={onDragMove}
      />,
    );
    // o2's line is at y = 210, 10 px under o1, so its label is pushed down to 244.
    expect(handleY('o2')).toBe(244);
    const o2 = screen.getAllByTestId('chart-handle').find((el) => el.dataset.line === 'o2');
    if (!o2) throw new Error('no o2');
    pointer(o2, 'pointerdown', 244);
    pointer(o2, 'pointermove', 254);
    // 10 px down from the line, not from the label: ₹1,490.00, not ₹1,473.00.
    expect(onDragMove).toHaveBeenLastCalledWith('o2', 149_000);
    pointer(o2, 'pointerup', 254);
  });
});

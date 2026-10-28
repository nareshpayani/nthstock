import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartHandle } from '@/features/charts';
import { AreaSeries, chartsMock, createChart } from '@/test/chartsMock';
import type { OverlayLine } from '../model/overlayLine';
import { ChartOverlay, DRAG_HINT_KEY, nearestLine } from './ChartOverlay';

const haptics = vi.hoisted(() => ({ haptic: vi.fn(() => true) }));
vi.mock('@/shared/motion/haptics', () => haptics);

// The fake scale: ₹1,600.00 at y = 0, 50 paise per px, a 300 px pane and a 64 px price axis.
function makeHandle(): ChartHandle {
  const host = document.createElement('div');
  document.body.append(host);
  const chart = createChart(host, {});
  const series = chart.addSeries(AreaSeries);
  return { chart, series, host } as unknown as ChartHandle;
}
const series = () => chartsMock.active().at(-1)?.series[0];
const chartOptions = () => chartsMock.active().at(-1)?.options as Record<string, unknown>;
const band = (id: string) => {
  const element = screen.getAllByTestId('chart-grab-band').find((el) => el.dataset.line === id);
  if (!element) throw new Error(`no band for ${id}`);
  return element;
};

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

// The first-run hint has its own tests; elsewhere it has been seen.
beforeEach(() => {
  window.localStorage.setItem(DRAG_HINT_KEY, '1');
});
afterEach(() => {
  window.localStorage.removeItem(DRAG_HINT_KEY);
  chartsMock.reset();
  haptics.haptic.mockClear();
});

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
    // The name is the visible label (WCAG 2.5.3); the long text is the description.
    expect(screen.getByRole('button', { name: 'Buy @ 150000' })).toHaveAccessibleDescription(
      'Buy limit at 150000',
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

  it('Escape mid-drag restores the line, and a pointer up after it sends nothing (T20, §9.1)', () => {
    const onDragEnd = vi.fn();
    render(
      <ChartOverlay
        handle={makeHandle()}
        tickSize={5}
        label="Chart orders"
        lines={[line({ id: 'o1', price: 150_000 })]}
        onDragEnd={onDragEnd}
      />,
    );
    const handle = screen.getByTestId('chart-handle');
    pointer(handle, 'pointerdown', 200);
    pointer(handle, 'pointermove', 160);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onDragEnd).toHaveBeenCalledExactlyOnceWith('o1', null);
    pointer(handle, 'pointerup', 160);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('a second finger on a chip press or a gutter press cancels it: no tap, no pan, no ghost (T20)', () => {
    const handle = makeHandle();
    const onHandleTap = vi.fn();
    const onGutterTap = vi.fn();
    render(
      <ChartOverlay
        handle={handle}
        tickSize={5}
        label="Chart orders for INFY"
        lines={[line({ id: 'pos', price: 150_000, tone: 'position', draggable: false })]}
        onHandleTap={onHandleTap}
        onGutterTap={onGutterTap}
      />,
    );
    const chip = screen.getByTestId('chart-handle');
    const range = () => chartsMock.active().at(-1)?.logicalRange;
    pointer(chip, 'pointerdown', 200, 1, 100);
    pointer(document.body, 'pointerdown', 200, 2, 200);
    pointer(chip, 'pointermove', 200, 1, 160);
    pointer(chip, 'pointerup', 200, 1, 160);
    expect(onHandleTap).not.toHaveBeenCalled();
    expect(range()).toEqual({ from: 0, to: 60 });

    const gutter = screen.getByTestId('chart-gutter');
    pointer(gutter, 'pointerdown', 100, 3);
    pointer(document.body, 'pointerdown', 120, 4);
    pointer(gutter, 'pointerup', 100, 3);
    expect(onGutterTap).not.toHaveBeenCalled();
  });

  it('a long-press on a handle or the gutter opens no menu (T20)', () => {
    render(
      <ChartOverlay
        handle={makeHandle()}
        tickSize={5}
        label="Chart orders"
        lines={[line({ id: 'o1', price: 150_000 })]}
      />,
    );
    expect(fireEvent.contextMenu(screen.getByTestId('chart-handle'))).toBe(false);
    expect(fireEvent.contextMenu(screen.getByTestId('chart-gutter'))).toBe(false);
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
  describe('grab band and gesture ownership (CR-T05, SPEC-CR-1 §5.1)', () => {
    it('puts a 44 px band across the plot on each draggable line, and none on the chip', () => {
      render(
        <ChartOverlay
          handle={makeHandle()}
          tickSize={5}
          label="Chart orders"
          lines={[
            line({ id: 'o1', price: 150_000 }),
            line({ id: 'far', price: 200_000 }),
            line({ id: 'pos', price: 140_000, tone: 'position', draggable: false }),
          ]}
        />,
      );
      expect(band('o1')).not.toHaveAttribute('hidden');
      expect(band('o1').style.transform).toBe('translateY(178px)');
      // Off the plot, only the pinned label takes a press.
      expect(band('far')).toHaveAttribute('hidden');
      expect(() => band('pos')).toThrow();
    });

    it('a press beside the line drags it by the finger, with the crosshair, scroll and scale off until release', () => {
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
      expect(chartOptions()).toMatchObject({ handleScroll: true, crosshair: { mode: 0 } });
      // 15 px under the line (y = 200), well off its label.
      pointer(band('o1'), 'pointerdown', 215);
      expect(chartOptions()).toMatchObject({
        crosshair: { mode: 2 },
        handleScroll: false,
        handleScale: false,
      });
      pointer(band('o1'), 'pointermove', 195);
      // 20 px up from the line, not from the finger: ₹1,510.00.
      expect(onDragMove).toHaveBeenLastCalledWith('o1', 151_000);
      pointer(band('o1'), 'pointerup', 195);
      expect(onDragEnd).toHaveBeenCalledWith('o1', 151_000);
      expect(chartOptions()).toMatchObject({
        crosshair: { mode: 0 },
        handleScroll: true,
        handleScale: true,
      });

      // A tap on the band opens nothing, and still gives the chart back.
      pointer(band('o1'), 'pointerdown', 205);
      pointer(band('o1'), 'pointerup', 205);
      expect(onHandleTap).not.toHaveBeenCalled();
      expect(chartOptions()).toMatchObject({ handleScroll: true });
    });

    it('Escape or a second finger mid-drag restores the line and the chart', () => {
      const onDragEnd = vi.fn();
      render(
        <ChartOverlay
          handle={makeHandle()}
          tickSize={5}
          label="Chart orders"
          lines={[line({ id: 'o1', price: 150_000 })]}
          onDragEnd={onDragEnd}
        />,
      );
      pointer(band('o1'), 'pointerdown', 200);
      pointer(band('o1'), 'pointermove', 170);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onDragEnd).toHaveBeenLastCalledWith('o1', null);
      expect(chartOptions()).toMatchObject({ crosshair: { mode: 0 }, handleScroll: true });

      pointer(band('o1'), 'pointerdown', 200, 1);
      pointer(band('o1'), 'pointermove', 170, 1);
      pointer(document.body, 'pointerdown', 100, 2);
      expect(onDragEnd).toHaveBeenCalledTimes(2);
      expect(chartOptions()).toMatchObject({ crosshair: { mode: 0 }, handleScroll: true });
    });

    it('gives the chart back when unmounted mid-drag', () => {
      const { unmount } = render(
        <ChartOverlay
          handle={makeHandle()}
          tickSize={5}
          label="Chart orders"
          lines={[line({ id: 'o1', price: 150_000 })]}
        />,
      );
      pointer(band('o1'), 'pointerdown', 200);
      unmount();
      expect(chartsMock.charts.at(-1)?.options).toMatchObject({ handleScroll: true });
    });

    it('where bands overlap, the nearer line wins; a tie goes to the line drawn on top', () => {
      const toY = (price: number) => (160_000 - price) / 50;
      const lines = [
        line({ id: 'a', price: 150_000 }), // y 200
        line({ id: 'b', price: 149_000 }), // y 220
        line({ id: 'ghost', price: 145_000, tone: 'ghost' }), // y 300
        line({ id: 'pos', price: 148_000, tone: 'position', draggable: false }), // y 240
      ];
      expect(nearestLine(lines, 206, toY)?.id).toBe('a');
      expect(nearestLine(lines, 214, toY)?.id).toBe('b');
      expect(nearestLine(lines, 210, toY)?.id).toBe('b');
      // The chip moves no price, so a press near it takes the nearest draggable line or nothing.
      expect(nearestLine(lines, 241, toY)?.id).toBe('b');
      expect(nearestLine(lines, 260, toY)).toBeNull();
      expect(nearestLine(lines, 290, toY)?.id).toBe('ghost');
    });
  });
  it('a drag shows the loupe beside the finger with the price, distance and value; release hides it (CR-T07)', () => {
    render(
      <ChartOverlay
        handle={makeHandle()}
        tickSize={5}
        label="Chart orders"
        ltp={152_000}
        lines={[line({ id: 'o1', price: 150_000, loupe: { kind: 'value', qty: 4 } })]}
      />,
    );
    const loupe = screen.getByTestId('chart-loupe');
    expect(loupe).toHaveAttribute('data-shown', 'false');
    pointer(band('o1'), 'pointerdown', 200);
    // A press alone is not a drag: no loupe for a tap.
    expect(loupe).toHaveAttribute('data-shown', 'false');
    pointer(band('o1'), 'pointermove', 180);
    expect(loupe).toHaveAttribute('data-shown', 'true');
    expect(loupe).toHaveTextContent('₹1,510.00');
    expect(loupe).toHaveTextContent('\u22120.66% from LTP');
    expect(loupe).toHaveTextContent('4 × ₹1,510.00 = ₹6,040.00');
    // Below the LTP the card sits right of the finger.
    expect(loupe).toHaveAttribute('data-side', 'right');
    pointer(band('o1'), 'pointerup', 180);
    expect(loupe).toHaveAttribute('data-shown', 'false');
  });

  it('a drag buzzes on pickup, per price step, harder across the LTP, and on release, and says so (CR-T08, AC-05)', () => {
    render(
      <ChartOverlay
        handle={makeHandle()}
        tickSize={5}
        label="Chart orders"
        ltp={149_000}
        lines={[line({ id: 'o1', price: 150_000, label: 'Buy 4 @ ₹1,500.00' })]}
      />,
    );
    const status = screen.getByRole('status');
    pointer(band('o1'), 'pointerdown', 200);
    // A press alone: nothing yet, so a tap never buzzes.
    expect(haptics.haptic).not.toHaveBeenCalled();
    pointer(band('o1'), 'pointermove', 210);
    expect(haptics.haptic).toHaveBeenLastCalledWith('grab');
    expect(status).toHaveTextContent(
      'Moving Buy 4 @ ₹1,500.00. Now ₹1,495.00. Release to save, a second finger or Escape cancels.',
    );
    pointer(band('o1'), 'pointermove', 212);
    expect(haptics.haptic).toHaveBeenLastCalledWith('tick');
    // The same price again is no step.
    haptics.haptic.mockClear();
    pointer(band('o1'), 'pointermove', 212);
    expect(haptics.haptic).not.toHaveBeenCalled();
    // ₹1,494.00 → ₹1,489.00 crosses the LTP at ₹1,490.00.
    pointer(band('o1'), 'pointermove', 222);
    expect(haptics.haptic).toHaveBeenLastCalledWith('crossLtp');
    pointer(band('o1'), 'pointerup', 222);
    expect(haptics.haptic).toHaveBeenLastCalledWith('commit');
    expect(status).toHaveTextContent('Moved to ₹1,489.00.');
  });

  it('a keyboard move says its start, its save and its cancel (CR-T08, §5.2)', () => {
    const onDragEnd = vi.fn();
    render(
      <ChartOverlay
        handle={makeHandle()}
        tickSize={5}
        label="Chart orders"
        onDragEnd={onDragEnd}
        lines={[line({ id: 'o1', price: 150_000, label: 'Buy 4 @ ₹1,500.00' })]}
      />,
    );
    const status = screen.getByRole('status');
    const target = screen.getByTestId('chart-handle');
    fireEvent.keyDown(target, { key: 'ArrowUp' });
    expect(status).toHaveTextContent(
      'Moving Buy 4 @ ₹1,500.00. Now ₹1,500.05. Enter saves, Escape cancels.',
    );
    fireEvent.keyDown(target, { key: 'ArrowUp' });
    fireEvent.keyDown(target, { key: 'Enter' });
    expect(onDragEnd).toHaveBeenLastCalledWith('o1', 150_010);
    expect(status).toHaveTextContent('Moved to ₹1,500.10.');
    expect(haptics.haptic).toHaveBeenCalledWith('commit');
    fireEvent.keyDown(target, { key: 'ArrowDown' });
    fireEvent.keyDown(target, { key: 'Escape' });
    expect(status).toHaveTextContent('Move cancelled. The line is back where it was.');
    fireEvent.keyDown(target, { key: 'ArrowDown' });
    status.textContent = '';
    fireEvent.blur(target);
    expect(onDragEnd).toHaveBeenLastCalledWith('o1', null);
    expect(status).toHaveTextContent('Move cancelled. The line is back where it was.');
  });

  it('a cancelled drag says the line went back, with no success haptic (CR-T08)', () => {
    render(
      <ChartOverlay
        handle={makeHandle()}
        tickSize={5}
        label="Chart orders"
        lines={[line({ id: 'o1', price: 150_000 })]}
      />,
    );
    pointer(band('o1'), 'pointerdown', 200);
    pointer(band('o1'), 'pointermove', 230);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Move cancelled. The line is back where it was.',
    );
    expect(haptics.haptic).not.toHaveBeenCalledWith('commit');
  });

  describe('lift and settle (CR-T06, SPEC-CR-1 §5.2, AC-04)', () => {
    it('a held line lifts: its tab and band are marked, its line thickens and the rest dim', () => {
      render(
        <ChartOverlay
          handle={makeHandle()}
          tickSize={5}
          label="Chart orders"
          lines={[line({ id: 'o1', price: 150_000 }), line({ id: 'o2', price: 145_000 })]}
        />,
      );
      const group = screen.getByRole('group', { name: 'Chart orders' });
      expect(group).toHaveAttribute('data-holding', 'false');
      expect(screen.getAllByTestId('chart-tab-grip')).toHaveLength(2);
      pointer(band('o1'), 'pointerdown', 210);
      expect(group).toHaveAttribute('data-holding', 'true');
      expect(band('o1')).toHaveAttribute('data-held', 'true');
      expect(band('o2')).toHaveAttribute('data-held', 'false');
      const [held, other] = series()?.priceLines ?? [];
      expect(held?.options).toMatchObject({ lineWidth: 2 });
      expect(String(other?.options.color)).toMatch(/^rgba\(\d+, \d+, \d+, 0\.45\)$/);

      pointer(band('o1'), 'pointerup', 210);
      expect(group).toHaveAttribute('data-holding', 'false');
      expect(held?.options).toMatchObject({ lineWidth: 1 });
      expect(String(other?.options.color)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('a cancelled drag springs the line back from where the finger left it', () => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.stubGlobal('cancelAnimationFrame', () => undefined);
      const handle = makeHandle();
      function Harness() {
        const [price, setPrice] = useState(150_000);
        return (
          <ChartOverlay
            handle={handle}
            tickSize={5}
            label="Chart orders"
            lines={[line({ id: 'o1', price })]}
            onDragMove={(_id, next) => setPrice(next)}
            onDragEnd={(_id, saved) => setPrice(saved ?? 150_000)}
          />
        );
      }
      try {
        render(<Harness />);
        pointer(band('o1'), 'pointerdown', 200);
        pointer(band('o1'), 'pointermove', 160);
        expect(series()?.priceLines[0]?.options.price).toBe(152_000);
        act(() => {
          fireEvent.keyDown(document, { key: 'Escape' });
        });
        // Still where the finger left it; the spring takes it home over the next frames.
        expect(series()?.priceLines[0]?.options.price).toBe(152_000);
        let now = 0;
        const seen: number[] = [];
        for (let i = 0; i < 60 && frames.length > 0; i += 1) {
          now += 1000 / 60;
          frames.shift()?.(now);
          seen.push(Number(series()?.priceLines[0]?.options.price));
        }
        expect(seen.at(-1)).toBe(150_000);
        // Never past home: a critically damped spring does not overshoot.
        expect(Math.min(...seen)).toBeGreaterThanOrEqual(150_000);
        expect(seen.some((price) => price > 150_000 && price < 152_000)).toBe(true);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    describe('a save rolled back after a reject (AC-04)', () => {
      // Drag o1 to ₹1,520.00 and release, then re-render the line at `backTo` after `afterMs`.
      let movedAgain: (price: number) => void = () => undefined;
      let removeLine: () => void = () => undefined;
      let unmount: () => void = () => undefined;
      const cancelFrame = vi.fn();
      function dragReleaseAndRollBack(afterMs: number, reducedMotion: boolean) {
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
          frames.push(callback);
          return frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', cancelFrame);
        vi.stubGlobal(
          'matchMedia',
          (query: string) => ({ matches: reducedMotion, media: query }) as MediaQueryList,
        );
        let clock = 1_000;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        const handle = makeHandle();
        const element = (price: number) => (
          <ChartOverlay
            handle={handle}
            tickSize={5}
            label="Chart orders"
            lines={[line({ id: 'o1', price })]}
          />
        );
        const view = render(element(150_000));
        pointer(band('o1'), 'pointerdown', 200);
        pointer(band('o1'), 'pointermove', 160);
        view.rerender(element(152_000));
        pointer(band('o1'), 'pointerup', 160);
        clock += afterMs;
        view.rerender(element(150_000));
        movedAgain = (price) => view.rerender(element(price));
        removeLine = () =>
          view.rerender(
            <ChartOverlay handle={handle} tickSize={5} label="Chart orders" lines={[]} />,
          );
        unmount = view.unmount;
        return frames;
      }
      const drawnPrice = () => series()?.priceLines[0]?.options.price;
      const runFrames = (frames: FrameRequestCallback[]) => {
        let now = 0;
        const seen: number[] = [];
        for (let i = 0; i < 90 && frames.length > 0; i += 1) {
          now += 1000 / 60;
          frames.shift()?.(now);
          seen.push(Number(drawnPrice()));
        }
        return seen;
      };
      afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
      });

      it('springs home from the dropped price when the answer comes within 10 s', () => {
        const frames = dragReleaseAndRollBack(9_999, false);
        expect(drawnPrice()).toBe(152_000);
        const seen = runFrames(frames);
        expect(seen.some((price) => price > 150_000 && price < 152_000)).toBe(true);
        expect(seen.at(-1)).toBe(150_000);
      });

      it('jumps home when the answer comes after 10 s', () => {
        const frames = dragReleaseAndRollBack(10_001, false);
        expect(drawnPrice()).toBe(150_000);
        expect(frames).toHaveLength(0);
      });

      it('ends at the newest price when the line moves again mid-spring', () => {
        const frames = dragReleaseAndRollBack(500, false);
        runFrames(frames.splice(0, 3));
        expect(drawnPrice()).not.toBe(150_000);
        movedAgain(148_000);
        runFrames(frames);
        expect(drawnPrice()).toBe(148_000);
      });

      it('survives its line being removed or the chart unmounting mid-spring', () => {
        const frames = dragReleaseAndRollBack(500, false);
        runFrames(frames.splice(0, 2));
        const pending = frames.splice(0);
        const removed = series()?.priceLines[0];
        const priceAtRemoval = removed?.options.price;
        cancelFrame.mockClear();
        removeLine();
        expect(removed?.removed).toBe(true);
        expect(cancelFrame).toHaveBeenCalled();
        expect(() => runFrames(pending)).not.toThrow();
        expect(removed?.options.price).toBe(priceAtRemoval);
        expect(series()?.priceLines).toHaveLength(0);

        const second = dragReleaseAndRollBack(500, false);
        runFrames(second.splice(0, 2));
        const queued = second.splice(0);
        unmount();
        expect(() => runFrames(queued)).not.toThrow();
      });

      it('settles at once under reduced motion', () => {
        const frames = dragReleaseAndRollBack(500, true);
        expect(drawnPrice()).toBe(150_000);
        expect(frames).toHaveLength(0);
      });
    });
  });
  describe('the first-run drag hint (CR-T20, SPEC-CR-1 §5.7)', () => {
    beforeEach(() => {
      window.localStorage.removeItem(DRAG_HINT_KEY);
    });
    const renderLines = (lines: OverlayLine[]) =>
      render(
        <ChartOverlay handle={makeHandle()} tickSize={5} label="Chart orders" lines={lines} />,
      );
    const hint = () => screen.queryByTestId('chart-drag-hint');

    it('shows once beside the first draggable line, nudging its tab, and is part of its description', () => {
      renderLines([
        line({ id: 'pos', price: 152_000, tone: 'position', draggable: false }),
        line({ id: 'o1', price: 150_000 }),
      ]);
      expect(hint()).toHaveTextContent('Drag the line to change the price');
      const handle = screen.getByRole('button', { name: 'Buy @ 150000' });
      expect(handle).toHaveAccessibleDescription(
        'Buy limit at 150000 Drag the line to change the price',
      );
      const tab = handle.querySelector('[data-testid="chart-tab"]');
      expect(tab?.className).toContain('animate-drag-hint');
      expect(tab?.className).toContain('motion-reduce:animate-none');
    });

    it('is not shown without a draggable line', () => {
      renderLines([line({ id: 'pos', price: 150_000, tone: 'position', draggable: false })]);
      expect(hint()).not.toBeInTheDocument();
    });

    it('goes away for good on any press on the chart', () => {
      const { unmount } = renderLines([line({ id: 'o1', price: 150_000 })]);
      const area = screen.getByTestId('chart-overlay').parentElement;
      if (!area) throw new Error('no chart area');
      act(() => {
        pointer(area, 'pointerdown', 50);
      });
      expect(hint()).not.toBeInTheDocument();
      expect(window.localStorage.getItem(DRAG_HINT_KEY)).toBe('1');
      unmount();
      renderLines([line({ id: 'o1', price: 150_000 })]);
      expect(hint()).not.toBeInTheDocument();
    });

    it('goes away on an arrow key on a line, not on Tab', () => {
      renderLines([line({ id: 'o1', price: 150_000 })]);
      const handle = screen.getByRole('button', { name: 'Buy @ 150000' });
      fireEvent.keyDown(handle, { key: 'Tab' });
      expect(hint()).toBeInTheDocument();
      fireEvent.keyDown(handle, { key: 'ArrowUp' });
      expect(hint()).not.toBeInTheDocument();
    });
  });
});

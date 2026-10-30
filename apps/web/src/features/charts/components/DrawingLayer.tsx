import type { Candle } from '@nthstock/contracts';
import { colors } from '@nthstock/tokens';
import { formatChange, formatIstDate, formatIstTime } from '@nthstock/utils';
import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
} from 'react';
import { toChartTime } from '../model/chartData';
import { formatChartValue, type ChartValueFormat } from '../model/chartFormat';
import {
  TWO_POINT_TOOLS,
  fibPrices,
  formatSpan,
  keepsEscape,
  logicalToTime,
  measure,
  priceStep,
  snapToBar,
  timeToLogical,
  type ChartPoint,
  type Drawing,
} from '../model/drawings';
import { useDrawings, useSymbolDrawings } from '../model/drawingsStore';
import { strings } from '../strings';
import type { ChartHandle } from './PriceChartCanvas';

export type DrawingLayerProps = {
  handle: ChartHandle;
  candles: readonly Candle[];
  symbol: string;
  format: ChartValueFormat;
};

/** The note box's width (Tailwind `w-44`), kept inside the plot's right edge. */
const NOTE_WIDTH = 176;
/** A press that travels further than this is a drag from the first point to the second. */
const DRAG_PX = 8;
// A user's drawings are ink, not brand blue: blue is for actions, and the Buy order lines are blue
// on the same chart (DESIGN.md).
const LINE = colors.ink;
/** Bars or price steps one Shift+arrow press moves the keyboard point. */
const FAST = 10;
/** Bars at least a day apart are named by date alone. */
const DAY = 86_400;

let nextId = 0;
const newId = () => `${Date.now().toString(36)}-${String((nextId += 1))}`;

/**
 * The drawings over the plot (NSTOCK-0461) and, while a tool is picked, the surface that takes the
 * taps: one tap for a horizontal line or a note, two taps (or one drag) for a trend line, ray,
 * Fibonacci levels, a measurement or a zoom. With no tool picked it lets every touch through, so
 * the chart pans and the trading lines drag as before. Drawings follow the chart through pans,
 * zooms and new bars, since they are stored as times and prices.
 */
export function DrawingLayer({ handle, candles, symbol, format }: DrawingLayerProps) {
  const { chart, series, host } = handle;
  const tool = useDrawings((state) => state.tool);
  const magnet = useDrawings((state) => state.magnet);
  const setTool = useDrawings((state) => state.setTool);
  const add = useDrawings((state) => state.add);
  const drawings = useSymbolDrawings(symbol);
  // Redraw when the chart moves under the drawings: a pan, a zoom, a resize or a price rescale.
  const [, repaint] = useReducer((count: number) => count + 1, 0);
  const [start, setStart] = useState<ChartPoint | null>(null);
  const [end, setEnd] = useState<ChartPoint | null>(null);
  const [measured, setMeasured] = useState<{ from: ChartPoint; to: ChartPoint } | null>(null);
  const [note, setNote] = useState<ChartPoint | null>(null);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  // The first point, in a ref too: the handlers of a quick second tap can run before the render
  // that would hand them the state. `armed` means the first tap is down and released.
  const startRef = useRef<ChartPoint | null>(null);
  const armedRef = useRef(false);
  // The keyboard point (NSTOCK-0468): a bar by its index and a price. `keyboard` is true while the
  // plot (or the note box opened from it) has focus, so the plot stays a tab stop until focus leaves.
  const [cursor, setCursor] = useState<{ index: number; price: number } | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [said, setSaid] = useState('');
  // The same words twice in a row (the first or last bar, two lines of one kind) are said again:
  // a zero-width space makes the second differ.
  const announce = (text: string) => setSaid((last) => (last === text ? `${text}\u200b` : text));
  const surfaceRef = useRef<HTMLDivElement>(null);
  const howToId = useId();

  // With nothing drawn, no tool picked and no read-out, the layer does not follow the chart, so a
  // chart without drawings costs no extra render per pan or crosshair move.
  const active =
    tool !== null || drawings.length > 0 || note !== null || measured !== null || keyboard;
  useEffect(() => {
    if (!active) return undefined;
    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(repaint);
    chart.subscribeCrosshairMove(repaint);
    // Missing in jsdom; the range and crosshair subscriptions still repaint.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(repaint);
    observer?.observe(host);
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(repaint);
      chart.unsubscribeCrosshairMove(repaint);
      observer?.disconnect();
    };
  }, [chart, host, active]);

  // A tool picked here is put down when this chart goes, so another chart is not armed at once.
  useEffect(() => () => setTool(null), [setTool]);

  // A new tool, or none, drops a half-made drawing.
  const [toolSeen, setToolSeen] = useState(tool);
  if (toolSeen !== tool) {
    setToolSeen(tool);
    setStart(null);
    setEnd(null);
  }
  useEffect(() => {
    startRef.current = null;
    armedRef.current = false;
  }, [tool]);

  useEffect(() => {
    if (tool === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      // The full-screen chart may have dropped the tool for this Escape already, and an Escape in
      // a menu or a field is that control's.
      if (event.key === 'Escape' && !event.defaultPrevented && !keepsEscape(event.target)) {
        setTool(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, setTool]);

  // The measure read-out stays mounted, so a new one is announced.
  const readout = (
    <p role="status" data-testid="measure-readout" className="sr-only">
      {measured && !(start && end && (tool === 'measure' || tool === 'zoom'))
        ? measureReadout(measured.from, measured.to, candles, format).text
        : ''}
    </p>
  );
  const size = plotSize(handle);
  if (!size) return readout;
  const { width, height } = size;
  const x = (time: number) =>
    chart.timeScale().logicalToCoordinate(timeToLogical(candles, time) as never) ?? -1;
  const y = (price: number) => series.priceToCoordinate(price) ?? -1;

  const pointAt = (event: PointerEvent<SVGSVGElement>): ChartPoint | null => {
    const box = event.currentTarget.getBoundingClientRect();
    const logical = chart.timeScale().coordinateToLogical(event.clientX - box.left);
    const price = series.coordinateToPrice(event.clientY - box.top);
    if (logical === null || price === null) return null;
    const point = { time: logicalToTime(candles, Number(logical)), price: Math.round(price) };
    return magnet ? snapToBar(point, candles) : point;
  };

  const finish = (from: ChartPoint, to: ChartPoint) => {
    if (tool === 'measure') {
      setMeasured({ from, to });
    } else if (tool === 'zoom') {
      const a = timeToLogical(candles, from.time);
      const b = timeToLogical(candles, to.time);
      if (Math.abs(b - a) >= 2) {
        chart.timeScale().setVisibleLogicalRange({ from: Math.min(a, b), to: Math.max(a, b) });
      }
    } else if (tool === 'trend' || tool === 'ray' || tool === 'fib') {
      add(symbol, { id: newId(), kind: tool, from, to });
    }
    setTool(null);
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    // The main button or the first finger only: a right click or a second finger is not a point.
    if (event.pointerType === 'touch' ? !event.isPrimary : event.button !== 0) return;
    const point = pointAt(event);
    if (!point || tool === null) return;
    // The tap is the tool's: not a tap that opens the chart page, nor a pan.
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current = { x: event.clientX, y: event.clientY };
    if (!startRef.current) {
      startRef.current = point;
      setStart(point);
      setEnd(point);
    }
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!startRef.current) return;
    const point = pointAt(event);
    if (point) setEnd(point);
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (tool !== null) event.stopPropagation();
    const press = pressRef.current;
    pressRef.current = null;
    const point = pointAt(event);
    const start = startRef.current;
    if (!press || !point || !start || tool === null) return;
    if (tool === 'horizontal') {
      add(symbol, { id: newId(), kind: 'horizontal', at: start });
      setTool(null);
      return;
    }
    if (tool === 'text') {
      setNote(start);
      setTool(null);
      return;
    }
    if (!TWO_POINT_TOOLS.includes(tool)) return;
    const dragged = Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_PX;
    // A drag sets both points at once; a tap sets the first, and the next tap the second.
    if (dragged || armedRef.current) {
      finish(start, point);
    } else {
      armedRef.current = true;
    }
  };

  const last = candles.length - 1;
  const clampIndex = (index: number) => Math.min(Math.max(0, index), Math.max(0, last));
  const cursorPoint = (at: { index: number; price: number }): ChartPoint | null => {
    const bar = candles[clampIndex(at.index)];
    if (!bar) return null;
    const point = { time: toChartTime(bar.t), price: at.price };
    return magnet ? snapToBar(point, candles) : point;
  };
  // The keyboard point starts on the right-most bar in view, at its close.
  const firstCursor = () => {
    const range = chart.timeScale().getVisibleLogicalRange?.();
    const index = clampIndex(range ? Math.floor(range.to) : last);
    return { index, price: candles[index]?.c ?? 0 };
  };
  const describePoint = (point: ChartPoint) => {
    const date = new Date(point.time * 1000);
    const daily =
      candles.length > 1 &&
      toChartTime(candles[1]?.t ?? '') - toChartTime(candles[0]?.t ?? '') >= DAY;
    const time = daily ? formatIstDate(date) : `${formatIstDate(date)} ${formatIstTime(date)}`;
    return { time, price: formatChartValue(point.price, format) };
  };

  // Enter at the keyboard point: what a tap there does, with the step said out loud.
  const placeFromKeyboard = (point: ChartPoint) => {
    if (tool === null) return;
    const name = strings.drawing.tools[tool];
    if (tool === 'horizontal') {
      add(symbol, { id: newId(), kind: 'horizontal', at: point });
      setTool(null);
      announce(strings.drawing.keyboard.placed(name));
      return;
    }
    if (tool === 'text') {
      setNote(point);
      setTool(null);
      return;
    }
    const first = startRef.current;
    if (!first) {
      startRef.current = point;
      armedRef.current = true;
      setStart(point);
      setEnd(point);
      const { time, price } = describePoint(point);
      announce(strings.drawing.keyboard.startPlaced(time, price));
      return;
    }
    // A zoom needs two bars between its ends; the first point stays for another try.
    if (
      tool === 'zoom' &&
      Math.abs(timeToLogical(candles, point.time) - timeToLogical(candles, first.time)) < 2
    ) {
      announce(strings.drawing.keyboard.tooClose);
      return;
    }
    finish(first, point);
    // The measure read-out speaks for the measure tool.
    if (tool !== 'measure') announce(strings.drawing.keyboard.placed(name));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (tool === null || event.altKey || event.ctrlKey || event.metaKey) return;
    const at = cursor ?? firstCursor();
    const bars = event.shiftKey ? FAST : 1;
    const step = () => {
      const top = series.coordinateToPrice(0);
      const bottom = series.coordinateToPrice(height);
      return priceStep(top === null || bottom === null ? 0 : top - bottom) * bars;
    };
    let next: typeof at;
    switch (event.key) {
      case 'ArrowLeft':
        next = { ...at, index: clampIndex(at.index - bars) };
        break;
      case 'ArrowRight':
        next = { ...at, index: clampIndex(at.index + bars) };
        break;
      case 'ArrowUp':
        next = { ...at, price: at.price + step() };
        break;
      case 'ArrowDown':
        next = { ...at, price: Math.max(0, at.price - step()) };
        break;
      case 'Home':
        next = { ...at, index: 0 };
        break;
      case 'End':
        next = { ...at, index: clampIndex(last) };
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const point = cursorPoint(at);
        if (point) placeFromKeyboard(point);
        return;
      }
      default:
        return;
    }
    // The arrows move the point, not the page.
    event.preventDefault();
    setCursor(next);
    const point = cursorPoint(next);
    if (!point) return;
    if (startRef.current) setEnd(point);
    const { time, price } = describePoint(point);
    announce(strings.drawing.keyboard.at(time, price));
  };

  const onSurfaceFocus = () => {
    setKeyboard(true);
    if (tool === null) return;
    const at = cursor ?? firstCursor();
    setCursor(at);
    const point = cursorPoint(at);
    if (!point) return;
    if (startRef.current) setEnd(point);
    const { time, price } = describePoint(point);
    announce(strings.drawing.keyboard.at(time, price));
  };
  const onSurfaceBlur = (event: FocusEvent<HTMLDivElement>) => {
    // Focus going to the note box opened from here keeps the plot a tab stop to come back to.
    const to = event.relatedTarget;
    if (to instanceof Node && event.currentTarget.parentElement?.contains(to)) return;
    setKeyboard(false);
  };
  const keyboardPoint = keyboard && tool !== null && cursor ? cursorPoint(cursor) : null;

  const preview: Drawing | null =
    start && end && tool && (tool === 'trend' || tool === 'ray' || tool === 'fib')
      ? { id: 'preview', kind: tool, from: start, to: end }
      : null;
  const liveMeasure =
    start && end && (tool === 'measure' || tool === 'zoom') ? { from: start, to: end } : null;

  return (
    <>
      <svg
        aria-hidden="true"
        data-testid="drawing-layer"
        data-tool={tool ?? undefined}
        width={width}
        height={height}
        className="absolute top-0 left-0 z-20"
        style={{
          pointerEvents: tool ? 'auto' : 'none',
          touchAction: tool ? 'none' : undefined,
          cursor: tool ? 'crosshair' : undefined,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          // A cancelled touch (a system gesture, a call) drops the half-made drawing too.
          pressRef.current = null;
          startRef.current = null;
          armedRef.current = false;
          setStart(null);
          setEnd(null);
        }}
      >
        {[...drawings, ...(preview ? [preview] : [])].map((drawing) => (
          <DrawingShape
            key={drawing.id}
            drawing={drawing}
            x={x}
            y={y}
            width={width}
            format={format}
          />
        ))}
        {liveMeasure ? (
          <MeasureBox
            {...liveMeasure}
            candles={candles}
            x={x}
            y={y}
            format={format}
            zoom={tool === 'zoom'}
          />
        ) : null}
        {measured && !liveMeasure ? (
          <MeasureBox {...measured} candles={candles} x={x} y={y} format={format} zoom={false} />
        ) : null}
        {keyboardPoint ? (
          <g data-testid="keyboard-point">
            <line
              x1={x(keyboardPoint.time)}
              x2={x(keyboardPoint.time)}
              y1={0}
              y2={height}
              stroke={colors['ink-muted']}
              strokeDasharray="4 3"
            />
            <line
              x1={0}
              x2={width}
              y1={y(keyboardPoint.price)}
              y2={y(keyboardPoint.price)}
              stroke={colors['ink-muted']}
              strokeDasharray="4 3"
            />
            <circle
              cx={x(keyboardPoint.time)}
              cy={y(keyboardPoint.price)}
              r={5}
              fill={colors.surface}
              stroke={LINE}
              strokeWidth={2}
            />
          </g>
        ) : null}
      </svg>
      {/* eslint-disable jsx-a11y-x/no-noninteractive-element-interactions, jsx-a11y-x/no-noninteractive-tabindex --
          role="application" is the WAI-ARIA role for a surface that takes its own arrow keys. */}
      {tool !== null || keyboard ? (
        <div
          ref={surfaceRef}
          role="application"
          tabIndex={0}
          aria-label={
            tool === null
              ? strings.drawing.keyboard.plot
              : `${strings.drawing.keyboard.plot}: ${strings.drawing.tools[tool]}`
          }
          aria-describedby={howToId}
          data-testid="drawing-keyboard"
          onKeyDown={onKeyDown}
          onFocus={onSurfaceFocus}
          onBlur={onSurfaceBlur}
          // Under the drawing surface and not hit by the pointer: taps still go to the SVG.
          className="pointer-events-none absolute top-0 left-0 z-10 rounded-sm focus-visible:ring-3 focus-visible:ring-brand focus-visible:outline-none focus-visible:ring-inset"
          style={{ width, height }}
        >
          <span id={howToId} className="sr-only">
            {tool === null ? strings.drawing.keyboard.noTool : strings.drawing.keyboard.howTo}
          </span>
        </div>
      ) : null}
      {/* eslint-enable jsx-a11y-x/no-noninteractive-element-interactions, jsx-a11y-x/no-noninteractive-tabindex */}
      <p role="status" data-testid="keyboard-readout" className="sr-only">
        {keyboard ? said : ''}
      </p>
      {readout}
      {measured && !liveMeasure ? (
        <button
          type="button"
          onClick={() => setMeasured(null)}
          className="absolute top-1 right-20 z-30 inline-flex min-h-11 items-center rounded-pill border border-line bg-surface px-4 text-label font-medium text-ink shadow-raised [@media(pointer:fine)]:min-h-8"
        >
          {strings.drawing.clearMeasure}
        </button>
      ) : null}
      {note ? (
        <NoteInput
          left={Math.min(x(note.time), width - NOTE_WIDTH)}
          top={y(note.price)}
          onDone={(text) => {
            if (text.trim())
              add(symbol, { id: newId(), kind: 'text', at: note, text: text.trim() });
            setNote(null);
            // A note placed from the keyboard hands focus back to the plot.
            if (keyboard) surfaceRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

/** The plot's size without the price axis; null once the chart has been removed. */
function plotSize({ chart, host }: ChartHandle): { width: number; height: number } | null {
  try {
    return {
      width: Math.max(0, host.clientWidth - chart.priceScale('right').width()),
      height: chart.paneSize(0).height,
    };
  } catch {
    // The library throws for a removed chart; a parent re-render with the new one is on its way.
    return null;
  }
}

type Project = { x: (time: number) => number; y: (price: number) => number };

function DrawingShape({
  drawing,
  x,
  y,
  width,
  format,
}: Project & { drawing: Drawing; width: number; format: ChartValueFormat }) {
  const label = (price: number) => formatChartValue(price, format).replace('₹', '');
  switch (drawing.kind) {
    case 'horizontal': {
      const row = y(drawing.at.price);
      return (
        <g>
          <line x1={0} x2={width} y1={row} y2={row} stroke={LINE} strokeWidth={1.5} />
          <text x={width - 4} y={row - 4} textAnchor="end" className="fill-ink text-label">
            {label(drawing.at.price)}
          </text>
        </g>
      );
    }
    case 'text':
      return (
        <text
          x={x(drawing.at.time)}
          y={y(drawing.at.price)}
          className="fill-ink text-label font-medium"
          paintOrder="stroke"
          stroke={colors.surface}
          strokeWidth={3}
        >
          {drawing.text}
        </text>
      );
    case 'fib': {
      const left = Math.min(x(drawing.from.time), x(drawing.to.time));
      return (
        <g>
          {fibPrices(drawing.from, drawing.to).map(({ level, price }) => (
            <g key={level}>
              <line
                x1={left}
                x2={width}
                y1={y(price)}
                y2={y(price)}
                stroke={level === 0.618 || level === 0.5 ? LINE : colors['ink-muted']}
                strokeWidth={1}
              />
              <text x={left + 4} y={y(price) - 3} className="fill-ink-muted text-label">
                {`${String(level)} (${label(price)})`}
              </text>
            </g>
          ))}
          <line
            x1={x(drawing.from.time)}
            y1={y(drawing.from.price)}
            x2={x(drawing.to.time)}
            y2={y(drawing.to.price)}
            stroke={colors['ink-muted']}
            strokeDasharray="3 3"
          />
        </g>
      );
    }
    default: {
      const x1 = x(drawing.from.time);
      const y1 = y(drawing.from.price);
      let x2 = x(drawing.to.time);
      let y2 = y(drawing.to.price);
      // A ray runs on through its second point to the plot's right edge.
      if (drawing.kind === 'ray' && x2 !== x1) {
        const slope = (y2 - y1) / (x2 - x1);
        const edge = x2 > x1 ? width : 0;
        y2 = y1 + slope * (edge - x1);
        x2 = edge;
      }
      return (
        <g>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={LINE} strokeWidth={1.5} />
          <circle cx={x1} cy={y1} r={3} fill={colors.surface} stroke={LINE} strokeWidth={1.5} />
          {drawing.kind === 'trend' ? (
            <circle cx={x2} cy={y2} r={3} fill={colors.surface} stroke={LINE} strokeWidth={1.5} />
          ) : null}
        </g>
      );
    }
  }
}

/** The measure tool's numbers: change, percent, bars and time, with which way it went. */
function measureReadout(
  from: ChartPoint,
  to: ChartPoint,
  candles: readonly Candle[],
  format: ChartValueFormat,
): { up: boolean; text: string } {
  const result = measure(from, to, candles);
  const up = result.change >= 0;
  const change = formatChange(result.basisPoints);
  const text = `${up ? '+' : '-'}${formatChartValue(Math.abs(result.change), format).replace('₹', '')} (${change.text}) · ${String(result.bars)} ${strings.drawing.bars} · ${formatSpan(result.seconds)}`;
  return { up, text };
}

/** The measure tool's read-out (and the zoom tool's span): a shaded box and its numbers. */
function MeasureBox({
  from,
  to,
  candles,
  x,
  y,
  format,
  zoom,
}: Project & {
  from: ChartPoint;
  to: ChartPoint;
  candles: readonly Candle[];
  format: ChartValueFormat;
  zoom: boolean;
}) {
  const left = Math.min(x(from.time), x(to.time));
  const top = Math.min(y(from.price), y(to.price));
  const boxWidth = Math.abs(x(to.time) - x(from.time));
  const boxHeight = zoom ? 9999 : Math.abs(y(to.price) - y(from.price));
  const { up, text } = measureReadout(from, to, candles, format);
  const tone = up ? colors.up : colors.down;
  return (
    <g data-testid="measure-box">
      <rect
        x={left}
        y={zoom ? 0 : top}
        width={boxWidth}
        height={boxHeight}
        fill={zoom ? colors['ink-muted'] : tone}
        fillOpacity={0.12}
        stroke={zoom ? colors['ink-muted'] : tone}
        strokeWidth={1}
      />
      {zoom ? null : (
        <text
          x={left + boxWidth / 2}
          y={Math.max(14, top - 6)}
          textAnchor="middle"
          className="text-label font-medium"
          fill={tone}
          paintOrder="stroke"
          stroke={colors.surface}
          strokeWidth={3}
        >
          {text}
        </text>
      )}
    </g>
  );
}

/** A one-line box at the tapped point for the note's text: Enter saves, Escape drops it. */
function NoteInput({
  left,
  top,
  onDone,
}: {
  left: number;
  top: number;
  onDone: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter, Escape and the blur that follows either one all end the note: only the first counts.
  const doneRef = useRef(false);
  const done = (value: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(value);
  };
  // The box appears where the finger was; focus follows it so the keyboard opens.
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <input
      ref={inputRef}
      aria-label={strings.drawing.noteLabel}
      value={text}
      maxLength={60}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') done(text);
        if (event.key === 'Escape') {
          // The note's Escape, not the full-screen chart's.
          event.preventDefault();
          event.stopPropagation();
          done('');
        }
      }}
      onBlur={() => done(text)}
      className="absolute z-30 h-11 w-44 rounded-md border border-brand bg-surface px-2 text-body text-ink shadow-raised focus-visible:ring-3 focus-visible:ring-brand-soft focus-visible:outline-none"
      style={{ left: Math.max(0, left), top: Math.max(0, top - 22) }}
    />
  );
}

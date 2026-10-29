import { cn, useTouchTargets } from '@nthstock/ui';
import type { ReactNode } from 'react';
import { DRAWING_TOOLS, type DrawingTool } from '../model/drawings';
import { useDrawings, useSymbolDrawings } from '../model/drawingsStore';
import { strings } from '../strings';

const svg = (children: ReactNode) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

/** 20 px line drawings of each tool, in the text colour. */
const GLYPHS: Record<DrawingTool | 'cursor' | 'magnet' | 'undo' | 'clear', ReactNode> = {
  cursor: svg(<path d="M10 3v5M10 12v5M3 10h5M12 10h5" />),
  trend: svg(
    <>
      <path d="M5 15 15 5" />
      <circle cx="4" cy="16" r="1.6" />
      <circle cx="16" cy="4" r="1.6" />
    </>,
  ),
  horizontal: svg(
    <>
      <path d="M2 10h16" />
      <circle cx="10" cy="10" r="1.6" />
    </>,
  ),
  ray: svg(
    <>
      <path d="M5 14 18 5" />
      <circle cx="4" cy="15" r="1.6" />
    </>,
  ),
  fib: svg(<path d="M3 4h14M3 8h14M3 11h14M3 16h14M5 16 15 4" strokeWidth="1.2" />),
  text: svg(<path d="M5 5h10M10 5v11M8 16h4" />),
  measure: svg(
    <>
      <rect x="2.5" y="7" width="15" height="6" rx="1" transform="rotate(-35 10 10)" />
      <path d="m6.5 12.6 1-1.4M9 10.8l1-1.4M11.6 9l1-1.4" />
    </>,
  ),
  zoom: svg(
    <>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="m12.5 12.5 4.5 4.5M8.5 6.5v4M6.5 8.5h4" />
    </>,
  ),
  magnet: svg(<path d="M5 3v7a5 5 0 0 0 10 0V3M5 6h3M12 6h3M8 3v7a2 2 0 0 0 4 0V3" />),
  undo: svg(<path d="M7 5 3.5 8.5 7 12M4 8.5h8a4.5 4.5 0 0 1 0 9H9" />),
  clear: svg(<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11M9 9v5M11 9v5" />),
};

function RailButton({
  label,
  pressed,
  disabled,
  touch,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  touch: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid place-items-center rounded-md text-ink hover:bg-canvas focus-visible:ring-3 focus-visible:ring-brand-soft focus-visible:outline-none disabled:opacity-40 aria-pressed:bg-brand-soft aria-pressed:text-brand',
        touch ? 'size-11' : 'size-9',
      )}
    >
      {children}
    </button>
  );
}

export type ToolRailProps = {
  symbol: string;
  /** 44 px buttons (phones and tablets). */
  touch?: boolean;
  /** The plot's height: the rail scrolls past it rather than growing the card. */
  height?: number;
  className?: string;
};

/**
 * The drawing tool rail beside the chart (NSTOCK-0461), as on a trading terminal: the crosshair,
 * the drawing tools, the magnet, undo and clear. Picking a tool says what to tap next.
 */
export function ToolRail({ symbol, touch: touchProp = false, height, className }: ToolRailProps) {
  const touch = useTouchTargets() || touchProp;
  const tool = useDrawings((state) => state.tool);
  const magnet = useDrawings((state) => state.magnet);
  const setTool = useDrawings((state) => state.setTool);
  const toggleMagnet = useDrawings((state) => state.toggleMagnet);
  const undo = useDrawings((state) => state.undo);
  const clear = useDrawings((state) => state.clear);
  const count = useSymbolDrawings(symbol).length;
  const canRestore = useDrawings((state) => state.cleared[symbol] !== undefined);
  return (
    <div className={cn('relative', className)}>
      <div
        role="toolbar"
        aria-label={strings.drawing.rail}
        aria-orientation="vertical"
        data-testid="tool-rail"
        className="flex flex-col items-center gap-1 overflow-y-auto"
        style={height ? { maxHeight: height } : undefined}
      >
        <RailButton
          label={strings.drawing.cursor}
          pressed={tool === null}
          touch={touch}
          onClick={() => setTool(null)}
        >
          {GLYPHS.cursor}
        </RailButton>
        {DRAWING_TOOLS.map((name) => (
          <RailButton
            key={name}
            label={strings.drawing.tools[name]}
            pressed={tool === name}
            touch={touch}
            onClick={() => setTool(tool === name ? null : name)}
          >
            {GLYPHS[name]}
          </RailButton>
        ))}
        <span aria-hidden="true" className="my-1 h-px w-6 bg-line" />
        <RailButton
          label={strings.drawing.magnet}
          pressed={magnet}
          touch={touch}
          onClick={toggleMagnet}
        >
          {GLYPHS.magnet}
        </RailButton>
        <RailButton
          label={strings.drawing.undo}
          disabled={count === 0 && !canRestore}
          touch={touch}
          onClick={() => undo(symbol)}
        >
          {GLYPHS.undo}
        </RailButton>
        <RailButton
          label={strings.drawing.clear}
          disabled={count === 0}
          touch={touch}
          onClick={() => clear(symbol)}
        >
          {GLYPHS.clear}
        </RailButton>
      </div>
      <p role="status" className="sr-only">
        {tool ? `${strings.drawing.tools[tool]}: ${strings.drawing.hints[tool]}` : ''}
      </p>
      {tool ? (
        <p
          aria-hidden="true"
          className="pointer-events-none absolute top-1 left-full z-30 ml-2 rounded-pill bg-ink px-3 py-1 text-label font-medium whitespace-nowrap text-surface shadow-raised"
        >
          {strings.drawing.hints[tool]}
        </p>
      ) : null}
    </div>
  );
}

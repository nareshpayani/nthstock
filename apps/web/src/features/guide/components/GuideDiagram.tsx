import { cn } from '@nthstock/ui';
import { useId, type ReactNode } from 'react';
import type { DiagramId } from '../model/guideContent';
import {
  FLOW_DIAGRAMS,
  logFraction,
  type FlowDiagramId,
  type FlowGeometry,
  type NodeTone,
  type Point,
} from '../model/diagrams';
import { strings } from '../strings';

const TONE: Record<NodeTone, string> = {
  brand: 'fill-brand-soft stroke-brand',
  neutral: 'fill-surface stroke-ink-muted',
  data: 'fill-canvas stroke-ink',
  warn: 'fill-marigold-soft stroke-marigold',
  done: 'fill-up-soft stroke-up',
};

const LINE_HEIGHT = 15;

/** useId's value made safe inside `url(#…)` references. */
const svgId = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

const pointsOf = (points: readonly Point[]) => points.map(([x, y]) => `${x},${y}`).join(' ');

/** The frame every diagram shares: a scrollable SVG on phones, a caption, and a text version. */
function DiagramFrame({
  title,
  description,
  width,
  height,
  inWords,
  children,
}: {
  title: string;
  description: string;
  width: number;
  height: number;
  inWords: readonly string[];
  children: (ids: { arrow: string }) => ReactNode;
}) {
  const base = svgId(useId());
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;
  return (
    <figure className="grid gap-2">
      {/* Phones scroll the diagram sideways, so the text stays readable; the page never does. */}
      <div
        role="region"
        aria-label={title}
        tabIndex={0}
        className="relative overflow-x-auto rounded-md border border-line bg-canvas p-2 outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto h-auto w-full max-w-[960px] min-w-[640px] font-sans"
        >
          <title id={titleId}>{title}</title>
          <desc id={descId}>{description}</desc>
          <defs>
            <marker
              id={`${base}-arrow`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className="fill-ink-muted" />
            </marker>
          </defs>
          {children({ arrow: `${base}-arrow` })}
        </svg>
      </div>
      <figcaption className="text-label text-ink-muted">{title}</figcaption>
      <details className="rounded-md border border-line bg-surface px-3 py-2">
        <summary className="min-h-11 cursor-pointer content-center text-body font-medium text-brand">
          {strings.inWords}
        </summary>
        <ol className="grid list-decimal gap-1.5 pt-2 pb-1 pl-5 text-body text-ink">
          {inWords.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </details>
    </figure>
  );
}

function FlowDiagram({ id }: { id: FlowDiagramId }) {
  const geometry: FlowGeometry = FLOW_DIAGRAMS[id];
  const copy = strings.diagrams[id];
  const groupLabels: Readonly<Record<string, string>> = copy.groups;
  const nodeLabels: Readonly<Record<string, readonly string[]>> = copy.nodes;
  const edgeLabels: Readonly<Record<string, string>> = copy.edges;
  return (
    <DiagramFrame
      title={copy.title}
      description={copy.description}
      width={geometry.width}
      height={geometry.height}
      inWords={copy.inWords}
    >
      {({ arrow }) => (
        <>
          {Object.entries(geometry.groups).map(([key, group]) => (
            <g key={key}>
              <rect
                x={group.x}
                y={group.y}
                width={group.w}
                height={group.h}
                rx={10}
                strokeWidth={1}
                strokeDasharray="4 4"
                className="fill-none stroke-line"
              />
              <text x={group.x + 10} y={group.y + 16} className="fill-ink-muted text-[11px]">
                {groupLabels[key]}
              </text>
            </g>
          ))}
          {Object.entries(geometry.edges).map(([key, edge]) => {
            const label = edgeLabels[key];
            return (
              <g key={key}>
                <polyline
                  points={pointsOf(edge.points)}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray={edge.dashed ? '5 4' : undefined}
                  markerEnd={`url(#${arrow})`}
                  className="stroke-ink-muted"
                />
                {edge.label && label ? (
                  <text
                    x={edge.label.at[0]}
                    y={edge.label.at[1]}
                    textAnchor={edge.label.anchor ?? 'middle'}
                    strokeWidth={4}
                    strokeLinejoin="round"
                    className="fill-ink stroke-canvas text-[11px] [paint-order:stroke]"
                  >
                    {label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {Object.entries(geometry.nodes).map(([key, node]) => {
            const lines = nodeLabels[key] ?? [];
            const firstBaseline = node.y + node.h / 2 - ((lines.length - 1) * LINE_HEIGHT) / 2 + 4;
            return (
              <g key={key}>
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.w}
                  height={node.h}
                  rx={8}
                  strokeWidth={1.5}
                  strokeDasharray={node.dashed ? '5 4' : undefined}
                  className={TONE[node.tone]}
                />
                {lines.map((line, index) => (
                  <text
                    key={line}
                    x={node.x + node.w / 2}
                    y={firstBaseline + index * LINE_HEIGHT}
                    textAnchor="middle"
                    className={cn(
                      'fill-ink',
                      index === 0 ? 'text-[13px] font-semibold' : 'text-[11px]',
                    )}
                  >
                    {line}
                  </text>
                ))}
              </g>
            );
          })}
        </>
      )}
    </DiagramFrame>
  );
}

const CHART = { width: 720, top: 36, row: 40, labelWidth: 236, barX: 248, barMax: 440 };

/** The load test's API p95 per run on a log axis, with the 200 ms target marked. */
function LoadTestChart() {
  const copy = strings.diagrams.loadTest;
  const { min, max } = copy.range;
  const x = (value: number) => CHART.barX + logFraction(value, min, max) * CHART.barMax;
  const height = CHART.top + copy.bars.length * CHART.row + 28;
  const targetX = x(copy.targetMs);
  return (
    <DiagramFrame
      title={copy.title}
      description={copy.description}
      width={CHART.width}
      height={height}
      inWords={copy.inWords}
    >
      {() => (
        <>
          <text x={CHART.barX} y={18} className="fill-ink-muted text-[11px]">
            {copy.axis}
          </text>
          {copy.ticks.map((tick) => (
            <g key={tick.label}>
              <line
                x1={x(tick.value)}
                x2={x(tick.value)}
                y1={CHART.top - 6}
                y2={height - 24}
                strokeWidth={1}
                className="stroke-line"
              />
              <text
                x={x(tick.value)}
                y={height - 8}
                textAnchor="middle"
                className="fill-ink-muted text-[11px]"
              >
                {tick.label}
              </text>
            </g>
          ))}
          <line
            x1={targetX}
            x2={targetX}
            y1={CHART.top - 10}
            y2={height - 24}
            strokeWidth={2}
            strokeDasharray="6 4"
            className="stroke-marigold"
          />
          <text x={targetX + 6} y={CHART.top - 4} className="fill-ink text-[11px] font-semibold">
            {copy.target}
          </text>
          {copy.bars.map((bar, index) => {
            const y = CHART.top + index * CHART.row;
            const over = bar.value > copy.targetMs;
            const inside = x(bar.value) > CHART.barX + CHART.barMax * 0.6;
            return (
              <g key={bar.label}>
                <text
                  x={CHART.labelWidth}
                  y={y + 18}
                  textAnchor="end"
                  className="fill-ink text-[12px]"
                >
                  {bar.label}
                </text>
                <rect
                  x={CHART.barX}
                  y={y + 4}
                  width={Math.max(2, x(bar.value) - CHART.barX)}
                  height={20}
                  rx={3}
                  className={over ? 'fill-down' : 'fill-brand'}
                />
                {/* A long bar carries its value inside, so the text never leaves the chart. */}
                <text
                  x={inside ? x(bar.value) - 6 : x(bar.value) + 6}
                  y={y + 18}
                  textAnchor={inside ? 'end' : 'start'}
                  strokeWidth={inside ? 0 : 4}
                  strokeLinejoin="round"
                  className={cn(
                    'stroke-canvas text-[12px] font-semibold [paint-order:stroke]',
                    inside ? 'fill-surface' : over ? 'fill-down' : 'fill-ink',
                  )}
                >
                  {over ? `${bar.shown} · ${copy.overTarget}` : bar.shown}
                </text>
              </g>
            );
          })}
        </>
      )}
    </DiagramFrame>
  );
}

/** One of the guide's inline SVG diagrams, with a caption and the same content as text. */
export function GuideDiagram({ id }: { id: DiagramId }) {
  return id === 'loadTest' ? <LoadTestChart /> : <FlowDiagram id={id} />;
}

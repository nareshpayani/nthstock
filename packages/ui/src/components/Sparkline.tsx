import { cn } from '../lib/cn.js';

export type SparklineProps = {
  /** Price points in any consistent unit (e.g. paise), oldest first. */
  points: readonly number[];
  /** Text alternative, e.g. "Nifty 50 today, up 0.84 percent". */
  label: string;
  width?: number;
  height?: number;
  /** Colour direction; defaults to last point vs first. */
  direction?: 'up' | 'down' | 'flat';
  className?: string;
};

/** Builds one SVG path through all points, scaled into the box. Flat series draw a centre line. */
export function sparklinePath(
  points: readonly number[],
  width: number,
  height: number,
  pad = 1,
): string {
  if (points.length === 0) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  return points
    .map((value, index) => {
      const x = pad + index * stepX;
      const y = range === 0 ? height / 2 : pad + (1 - (value - min) / range) * (height - pad * 2);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join('');
}

export function Sparkline({
  points,
  label,
  width = 96,
  height = 32,
  direction,
  className,
}: SparklineProps) {
  const first = points[0] ?? 0;
  const last = points[points.length - 1] ?? 0;
  const dir = direction ?? (last > first ? 'up' : last < first ? 'down' : 'flat');
  const tone = dir === 'up' ? 'text-up' : dir === 'down' ? 'text-down' : 'text-ink-muted';
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className={cn('shrink-0 overflow-visible', tone, className)}
      data-direction={dir}
    >
      <path
        d={sparklinePath(points, width, height)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

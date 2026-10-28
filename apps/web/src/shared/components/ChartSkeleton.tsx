import { Skeleton } from '@nthstock/ui';

/** Grid rows across the plot, like the chart's own price grid. */
const ROWS = 5;
/** The price axis's width (the chart's right scale with ₹ labels) and the time axis's height. */
const AXIS_WIDTH = 64;
const TIME_AXIS_HEIGHT = 28;

export type ChartSkeletonProps = {
  /** The plot's height in px, the same as the chart it stands in for. */
  height: number;
  /** Accessible name of the loading state, e.g. "Loading chart". */
  label: string;
};

/**
 * A price chart while it loads, in the chart's own shape (SPEC-CR-1 §5.6, §7): the plot with its
 * grid lines, the price axis with label stubs down the right, and the time axis along the bottom.
 * Same height as the chart, so nothing moves when it arrives.
 */
export function ChartSkeleton({ height, label }: ChartSkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      data-testid="chart-skeleton"
      className="grid h-full w-full"
      style={{
        height,
        gridTemplateColumns: `minmax(0,1fr) ${String(AXIS_WIDTH)}px`,
        gridTemplateRows: `minmax(0,1fr) ${String(TIME_AXIS_HEIGHT)}px`,
      }}
    >
      <div
        aria-hidden="true"
        className="relative grid animate-shimmer overflow-hidden motion-reduce:animate-none"
        style={{ gridTemplateRows: `repeat(${String(ROWS)}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: ROWS }, (_, row) => (
          <span key={row} className="border-b border-line" />
        ))}
        <span className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-line/60 to-transparent" />
      </div>
      <div
        aria-hidden="true"
        className="grid items-start border-l border-line pl-2"
        style={{ gridTemplateRows: `repeat(${String(ROWS)}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: ROWS }, (_, row) => (
          <Skeleton key={row} className="-mt-1.5 h-3 w-12" />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="flex items-center justify-between border-t border-line px-2"
      >
        <Skeleton className="h-3 w-9" />
        <Skeleton className="h-3 w-9" />
        <Skeleton className="h-3 w-9" />
      </div>
    </div>
  );
}

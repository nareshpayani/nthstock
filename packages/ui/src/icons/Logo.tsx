import { cn } from '../lib/cn.js';

export type LogoProps = {
  /** Show "stock" after the brand word. Without it the logo is the app icon tile. Defaults to true. */
  withWordmark?: boolean;
  className?: string;
};

/**
 * The brand word "nth" is drawn on a 64-unit body (x-height 48) with round-ended strokes. Stroke ends
 * sit on the baseline at y = 64, so the SVG's bottom edge is the text baseline. The PWA icons in
 * apps/web/public use these paths; the favicon keeps only the "n" and a shorter rising line.
 */
const STROKE = 13;
/** The crossbar is a lighter stroke so the rising line reads as a line, not a letter part. */
const RISE_STROKE = 10;
/** The navy "n". */
const N_PATH = 'M7.5 57.5V36a13.5 13.5 0 0 1 27 0v21.5';
/** The blue "th": the stem and foot of the "t", then the "h". */
const TH_PATH = 'M58 12V48a9.5 9.5 0 0 0 9.5 9.5H71M88 6.5V57.5M88 36a13.5 13.5 0 0 1 27 0v21.5';
/** The crossbar of the "t", drawn as a small rising price line. */
const RISE_PATH = 'M48 35L55 29L60.5 32.5L72 20';

/**
 * The brand mark's strokes, for a drawing of the mark outside this component (the order-placed
 * moment draws the rising line in). 64-unit body, round caps and joins.
 */
export const LOGO_MARK = {
  n: N_PATH,
  th: TH_PATH,
  rise: RISE_PATH,
  stroke: STROKE,
  riseStroke: RISE_STROKE,
} as const;

function Stroke({
  d,
  className,
  width = STROKE,
}: {
  d: string;
  className: string;
  width?: number;
}) {
  return (
    <path
      d={d}
      fill="none"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    />
  );
}

/**
 * nthstock logo, in the pattern of a bold two-tone brand word and a lighter second word: a navy
 * "n" and a brand-blue "th" whose "t" crosses with a rising line, then "stock" in Plex Sans regular. Size it with the font size (the
 * brand word is 0.71 em tall); without the wordmark it is the 28 px app icon tile.
 * The whole logo has one accessible name.
 */
export function Logo({ withWordmark = true, className }: LogoProps) {
  if (!withWordmark) {
    return (
      <span className={cn('inline-flex', className)} role="img" aria-label="nthstock">
        <svg width="28" height="28" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <rect width="120" height="120" rx="27" className="fill-brand" />
          <g transform="translate(19.74 38.22) scale(.66)">
            <Stroke d={N_PATH} className="stroke-surface" />
            <Stroke d={TH_PATH} className="stroke-brand-soft" />
            <Stroke d={RISE_PATH} width={RISE_STROKE} className="stroke-marigold" />
          </g>
        </svg>
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-[0.156em] text-[32px] leading-none font-normal tracking-[-0.022em] text-ink',
        className,
      )}
      role="img"
      aria-label="nthstock"
    >
      <svg
        viewBox="0 0 122 64"
        className="h-[0.711em] w-auto shrink-0"
        aria-hidden="true"
        focusable="false"
      >
        <Stroke d={N_PATH} className="stroke-ink" />
        <Stroke d={TH_PATH} className="stroke-brand" />
        <Stroke d={RISE_PATH} width={RISE_STROKE} className="stroke-brand" />
      </svg>
      <span aria-hidden="true">stock</span>
    </span>
  );
}

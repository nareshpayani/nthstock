import { colors } from '@nthstock/tokens';
import { cn } from '@nthstock/ui';
import type { LegendContent } from '../model/chartLegend';
import { STUDY_LINE_STYLES } from '../model/chartTheme';
import { strings } from '../strings';

/** The study a legend key belongs to: `bollinger-upper` → `bollinger`. */
const studyOf = (key: string) => key.split('-')[0] as keyof typeof STUDY_LINE_STYLES;

/** A 12 px sample of the line, solid, dashed or dotted, so the key does not rely on colour. */
function Swatch({ studyKey }: { studyKey: string }) {
  const style = STUDY_LINE_STYLES[studyOf(studyKey)];
  const dash = style.lineStyle === 0 ? undefined : style.lineStyle === 1 ? '1 2' : '3 2';
  return (
    <svg width="12" height="4" aria-hidden="true" className="shrink-0">
      <line
        x1="0"
        y1="2"
        x2="12"
        y2="2"
        stroke={style.color}
        strokeWidth="2"
        strokeDasharray={dash}
      />
    </svg>
  );
}

/**
 * The legend over the plot's top left (NSTOCK-0460), as on a trading terminal: O, H, L and C of
 * the bar under the crosshair (the last bar otherwise), its change, volume, and each indicator's
 * value. A pointer aid like the tooltip: the figure's text summary serves assistive technology.
 */
export function ChartLegend({ values, change, volume, studies }: LegendContent) {
  const tone =
    change.direction === 'up'
      ? 'text-up'
      : change.direction === 'down'
        ? 'text-down'
        : 'text-ink-muted';
  return (
    <div
      aria-hidden="true"
      data-testid="chart-legend"
      className="pointer-events-none absolute top-1 left-2 z-10 grid max-w-[calc(100%-5rem)] gap-0.5 font-mono text-label tabular-nums"
      style={{ textShadow: `0 0 3px ${colors.surface}` }}
    >
      <p className="m-0 flex flex-wrap items-baseline gap-x-2">
        {values.map((value) => (
          <span key={value.label} className="whitespace-nowrap">
            <span className="text-ink-muted">{value.label}</span>
            <span className={cn('ml-0.5', tone)}>{value.value}</span>
          </span>
        ))}
        <span className={cn('whitespace-nowrap', tone)}>{change.text}</span>
        {volume !== null ? (
          <span className="whitespace-nowrap">
            <span className="text-ink-muted">{strings.legend.volume}</span>
            <span className="ml-1 text-ink">{volume}</span>
          </span>
        ) : null}
      </p>
      {studies.length > 0 ? (
        <p className="m-0 flex flex-wrap items-center gap-x-2">
          {studies.map((study) => (
            <span key={study.key} className="inline-flex items-center gap-1 whitespace-nowrap">
              <Swatch studyKey={study.key} />
              <span className="text-ink-muted">{study.label}</span>
              <span className="text-ink">{study.value}</span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

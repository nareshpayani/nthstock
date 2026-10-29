import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconChevronDown,
  cn,
  useTouchTargets,
} from '@nthstock/ui';
import { STUDY_IDS } from '../model/studies';
import { useChartStudies } from '../model/studiesStore';
import { strings } from '../strings';

/** A 16 px drawing of an indicator over bars, in the text colour. */
function IndicatorsGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M3 14v-3M6.5 14V9M10 14v-4M13.5 14V7" />
      <path d="M1.5 7.5 5 4.5l3 2 5.5-4.5" />
    </svg>
  );
}

export type IndicatorsMenuProps = {
  /** 44 px trigger on phones. */
  touch?: boolean;
};

/**
 * The indicators picker (NSTOCK-0460): volume, moving averages, VWAP and Bollinger bands, each a
 * checkbox with a line on what it shows. One choice for every chart, remembered on this device.
 */
export function IndicatorsMenu({ touch: touchProp = false }: IndicatorsMenuProps) {
  const touch = useTouchTargets() || touchProp;
  const studies = useChartStudies((state) => state.studies);
  const toggleStudy = useChartStudies((state) => state.toggleStudy);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={strings.studies.buttonLabel(studies.length)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 text-body font-medium text-ink hover:bg-surface focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft focus-visible:outline-none',
          touch ? 'h-11' : 'h-8',
        )}
      >
        <IndicatorsGlyph />
        {/* On a phone the drawing and the count say it; the word would push the row off screen. */}
        <span className={touch ? 'sr-only' : undefined}>{strings.studies.button}</span>
        {/* A real space, so the visible text reads "Indicators 2", as the name starts. */}{' '}
        {studies.length > 0 ? (
          <span className="rounded-pill bg-brand-soft px-1.5 text-label text-brand">
            {studies.length}
          </span>
        ) : null}
        <IconChevronDown size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuLabel>{strings.studies.heading}</DropdownMenuLabel>
        {STUDY_IDS.map((study) => (
          <DropdownMenuCheckboxItem
            key={study}
            checked={studies.includes(study)}
            onCheckedChange={() => toggleStudy(study)}
            // Keep the menu open, so several can be picked in one go.
            onSelect={(event) => event.preventDefault()}
            className={cn('items-start', touch && 'min-h-11')}
          >
            <span className="grid">
              <span className="font-medium">{strings.studies.names[study]}</span>
              <span className="text-label text-ink-muted">{strings.studies.hints[study]}</span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

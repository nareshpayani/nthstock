import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconChevronDown,
  cn,
  useTouchTargets,
} from '@nthstock/ui';
import { PRICE_CHART_TYPES, type PriceChartType } from '../model/chartTypes';
import { strings } from '../strings';

/** 16 px line drawings of each type, in the text colour (NSTOCK-0430). */
function TypeGlyph({ type }: { type: PriceChartType }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    'aria-hidden': true,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (type) {
    case 'line':
      return (
        <svg {...common}>
          <path d="M1.5 11.5 5 7l3 2.5 3.5-5 3 2" />
        </svg>
      );
    case 'area':
      return (
        <svg {...common}>
          <path d="M1.5 11 5 6.5 8 9l3.5-5 3 2" />
          <path
            d="M1.5 11 5 6.5 8 9l3.5-5 3 2V14.5h-13Z"
            fill="currentColor"
            fillOpacity={0.2}
            stroke="none"
          />
        </svg>
      );
    case 'candle':
      return (
        <svg {...common}>
          <path d="M4.5 2v12M11.5 2v12" />
          <rect x="3" y="5" width="3" height="5" fill="var(--nth-color-surface)" />
          <rect x="10" y="4" width="3" height="6" fill="currentColor" />
        </svg>
      );
    case 'bar':
      return (
        <svg {...common}>
          <path d="M5 2.5v11M3 5h2M5 10h2M11 3.5v10M9 11h2M11 6h2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4.5 3v10M11.5 2v10" />
          <rect x="3" y="5" width="3" height="5" rx="1.5" fill="var(--nth-color-surface)" />
          <rect x="10" y="4" width="3" height="5" rx="1.5" fill="currentColor" />
        </svg>
      );
  }
}

export type ChartTypeMenuProps = {
  value: PriceChartType;
  onValueChange: (type: PriceChartType) => void;
  /** 44 px trigger on phones. */
  touch?: boolean;
};

/**
 * Chart type picker (NSTOCK-0430): one compact button with the current type's drawing and name,
 * opening a menu of all five with a line on what each shows. A menu, not five segments, so it fits
 * beside the bar size on a 320 px phone and beside the ranges on desktop. Used by the instrument
 * page and the dashboard chart (NSTOCK-0443).
 */
export function ChartTypeMenu({
  value,
  onValueChange,
  touch: touchProp = false,
}: ChartTypeMenuProps) {
  // A tablet's desktop layout asks for touch sizes through the context (SPEC-CR-1 §6.3).
  const touch = useTouchTargets() || touchProp;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={strings.typeButton(strings.types[value])}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 text-body font-medium text-ink hover:bg-surface focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand-soft focus-visible:outline-none',
          touch ? 'h-11' : 'h-8',
        )}
      >
        <TypeGlyph type={value} />
        <span>{strings.types[value]}</span>
        <IconChevronDown size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const type = PRICE_CHART_TYPES.find((candidate) => candidate === next);
            if (type) onValueChange(type);
          }}
        >
          {PRICE_CHART_TYPES.map((type) => (
            <DropdownMenuRadioItem
              key={type}
              value={type}
              className={cn('items-start', touch && 'min-h-11')}
            >
              <span className="mt-0.5 shrink-0 text-ink-muted">
                <TypeGlyph type={type} />
              </span>
              <span className="grid">
                <span className="font-medium">{strings.types[type]}</span>
                <span className="text-label text-ink-muted">{strings.typeHints[type]}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { colors } from '@nthstock/tokens';
import type { LineStyle } from 'lightweight-charts';
import type { OverlayTone } from '../model/overlayLine';

// The library's `LineStyle` values, written out so this module never imports the charts library
// at runtime: it loads only with the lazy chart canvas (scripts/checkBuild.mjs).
const SOLID = 0 as LineStyle;
const DOTTED = 1 as LineStyle;
const DASHED = 2 as LineStyle;

/**
 * How each kind of line is drawn on the canvas (SPEC-TFC-1 §8.1). The canvas cannot read CSS
 * variables, so the colours come from the token object, as the chart theme's do.
 */
export const LINE_STYLES: Record<OverlayTone, { color: string; lineStyle: LineStyle }> = {
  buy: { color: colors.brand, lineStyle: SOLID },
  sell: { color: colors.down, lineStyle: SOLID },
  ghost: { color: colors['ink-muted'], lineStyle: DASHED },
  position: { color: colors.ink, lineStyle: SOLID },
  trailing: { color: colors.marigold, lineStyle: DASHED },
  activation: { color: colors.marigold, lineStyle: DOTTED },
  pending: { color: colors['ink-muted'], lineStyle: DOTTED },
};

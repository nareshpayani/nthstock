import type { IPriceLine, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { OverlayLine } from '../model/overlayLine';
import { LINE_STYLES } from './lineStyles';

/**
 * Keeps the library's price lines in step with the overlay's lines (SPEC-TFC-1 §10.5): creates
 * new ones, moves changed ones with `applyOptions`, and removes the rest. `drawn` is updated in
 * place and keyed by line id.
 */
export function syncPriceLines(
  series: ISeriesApi<SeriesType>,
  drawn: Map<string, { line: IPriceLine; price: number; tone: OverlayLine['tone'] }>,
  lines: readonly OverlayLine[],
): void {
  const wanted = new Set<string>();
  for (const spec of lines) {
    wanted.add(spec.id);
    const style = LINE_STYLES[spec.tone];
    const current = drawn.get(spec.id);
    if (!current) {
      const line = series.createPriceLine({
        price: spec.price,
        ...style,
        lineWidth: 1,
        lineVisible: true,
        axisLabelVisible: true,
        title: '',
      });
      drawn.set(spec.id, { line, price: spec.price, tone: spec.tone });
    } else if (current.price !== spec.price || current.tone !== spec.tone) {
      current.line.applyOptions({ price: spec.price, ...style });
      current.price = spec.price;
      current.tone = spec.tone;
    }
  }
  for (const [id, current] of drawn) {
    if (wanted.has(id)) continue;
    series.removePriceLine(current.line);
    drawn.delete(id);
  }
}

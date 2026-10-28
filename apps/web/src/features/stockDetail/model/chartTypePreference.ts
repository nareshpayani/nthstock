import { safeStorage } from '@/shared/lib/safeStorage';
import { CHART_TYPES, DEFAULT_CHART_TYPE, type ChartType } from './stockDetailSearch';

const KEY = 'nthstock.chartType';

/**
 * The chart type this browser last picked (NSTOCK-0430), used when the URL names none; the URL
 * still wins, so a shared link shows what its sender saw.
 */
export function rememberedChartType(): ChartType {
  const stored = safeStorage.get(KEY);
  return CHART_TYPES.find((type) => type === stored) ?? DEFAULT_CHART_TYPE;
}

export function rememberChartType(type: ChartType): void {
  safeStorage.set(KEY, type);
}

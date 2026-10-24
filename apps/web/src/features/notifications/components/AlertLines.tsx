import type { Exchange } from '@nthstock/contracts';
import { colors } from '@nthstock/tokens';
import { useQuery } from '@tanstack/react-query';
import type { IPriceLine, LineStyle } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { ChartHandle } from '@/features/charts';
import { useSession } from '@/shared/hooks/useSession';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { priceAlertsQuery } from '../api/alertsQuery';
import { strings } from '../strings';

// The library's dotted `LineStyle`, written out so nothing here imports the charts library at
// runtime (it loads only with the lazy chart canvas).
const DOTTED = 1 as LineStyle;

export type AlertLinesProps = { handle: ChartHandle; symbol: string; exchange: Exchange };

/**
 * The stock's active price alerts as dotted lines on the chart, labelled "Alert" on the price axis
 * (NSTOCK-0344). A line goes away when its alert fires or is removed.
 */
export function AlertLines({ handle, symbol, exchange }: AlertLinesProps) {
  const { status } = useSession();
  const api = useApiClient();
  const alerts = useQuery({ ...priceAlertsQuery(api), enabled: status === 'authenticated' });
  const drawn = useRef(new Map<string, IPriceLine>());
  const levels = (alerts.data?.items ?? [])
    .filter((a) => a.status === 'ACTIVE' && a.symbol === symbol && a.exchange === exchange)
    .map((a) => `${a.id}:${String(a.price)}`)
    .join(',');

  useEffect(() => {
    const { series } = handle;
    const wanted = new Map(
      levels
        .split(',')
        .filter(Boolean)
        .map((entry) => {
          const [id = '', price = '0'] = entry.split(':');
          return [id, Number(price)] as const;
        }),
    );
    for (const [id, line] of drawn.current) {
      if (wanted.has(id)) continue;
      series.removePriceLine(line);
      drawn.current.delete(id);
    }
    for (const [id, price] of wanted) {
      if (drawn.current.has(id)) continue;
      drawn.current.set(
        id,
        series.createPriceLine({
          price,
          color: colors.brand,
          lineStyle: DOTTED,
          lineWidth: 1,
          lineVisible: true,
          axisLabelVisible: true,
          title: strings.chartLine,
        }),
      );
    }
  }, [handle, levels]);

  useEffect(() => {
    const lines = drawn.current;
    const { series } = handle;
    return () => {
      for (const line of lines.values()) series.removePriceLine(line);
      lines.clear();
    };
  }, [handle]);

  return null;
}

import type { ApiClient } from '@nthstock/apiClient';

/** The demo's opening trade: an intraday buy guarded by a 1% trailing stop. */
export const DEMO_POSITION_QTY = 10;
export const DEMO_TRAIL_BASIS_POINTS = 100;

/**
 * Opens the demo's position on `symbol` (an intraday market buy with an attached trailing stop),
 * so the reviewer lands on a chart that already shows a position line and a trailing-stop line.
 * Skipped when the account already holds an intraday position there. Best effort: a refusal
 * leaves the demo as it was, without a position.
 */
export async function openDemoPosition(api: ApiClient, symbol: string): Promise<void> {
  try {
    const { items } = await api.request('positionsList');
    if (items.some((p) => p.symbol === symbol && p.product === 'INTRADAY' && p.netQty !== 0)) {
      return;
    }
    const instrument = await api.request('instrument', { params: { symbol } });
    await api.request('orderPlace', {
      body: {
        token: instrument.token,
        side: 'BUY',
        type: 'MARKET',
        product: 'INTRADAY',
        qty: DEMO_POSITION_QTY,
        attachedTrailingStop: {
          trail: { unit: 'PERCENT', basisPoints: DEMO_TRAIL_BASIS_POINTS },
        },
      },
    });
  } catch {
    // The demo still opens; the reviewer can place the trade by hand.
  }
}

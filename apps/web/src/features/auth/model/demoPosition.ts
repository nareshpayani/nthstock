import type { ApiClient } from '@nthstock/apiClient';

/** The demo's opening trade: an intraday buy guarded by a 1% trailing stop. */
export const DEMO_POSITION_QTY = 10;
export const DEMO_TRAIL_BASIS_POINTS = 100;

/** What became of the demo position: placed now, already open, or not placed (a refusal). */
export type DemoPositionOutcome = 'opened' | 'skipped' | 'failed';

/**
 * Opens the demo's position on `symbol` (an intraday market buy with an attached trailing stop),
 * so the reviewer lands on a chart that already shows a position line and a trailing-stop line.
 * Skipped when the account already holds an intraday position there. Never throws: a refused or
 * failed order is `failed`, and the demo opens without a position.
 */
export async function openDemoPosition(
  api: ApiClient,
  symbol: string,
): Promise<DemoPositionOutcome> {
  try {
    const { items } = await api.request('positionsList');
    if (items.some((p) => p.symbol === symbol && p.product === 'INTRADAY' && p.netQty !== 0)) {
      return 'skipped';
    }
    const instrument = await api.request('instrument', { params: { symbol } });
    const order = await api.request('orderPlace', {
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
    // Only a filled order is a position. A refusal (the market closed, say) comes back as a
    // REJECTED order, not an error; an AMO or open order has no position yet.
    if (order.status !== 'EXECUTED') {
      console.warn(
        `The demo position on ${symbol} did not fill`,
        order.statusReason ?? order.status,
      );
      return 'failed';
    }
    return 'opened';
  } catch (failure) {
    // The demo still opens; the reviewer can place the trade by hand.
    console.warn(`The demo position on ${symbol} did not open`, failure);
    return 'failed';
  }
}

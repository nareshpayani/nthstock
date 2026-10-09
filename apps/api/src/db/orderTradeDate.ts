import {
  MARKET_CLOSE,
  isTradingDay,
  istDateKey,
  nextSessionOpen,
  toIstParts,
} from '@nthstock/utils';

/**
 * The IST trading day an order placed at `placedAt` belongs to, as `YYYY-MM-DD` (the `trade_date`
 * partition key, spec backend-core §4.3). An order placed on a trading day before the 15:30 close
 * belongs to that day; a later one (an AMO at 20:00, or any order on a weekend or holiday) to the
 * next session.
 */
export function orderTradeDate(placedAt: Date): string {
  const { minuteOfDay } = toIstParts(placedAt);
  if (isTradingDay(placedAt) && minuteOfDay < MARKET_CLOSE) return istDateKey(placedAt);
  return istDateKey(nextSessionOpen({ now: () => placedAt }));
}

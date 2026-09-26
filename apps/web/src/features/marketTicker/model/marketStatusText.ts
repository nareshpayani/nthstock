import {
  IST_TIME_ZONE,
  formatIstTime,
  getMarketStatus,
  istDateKey,
  nextSessionOpen,
  type Clock,
} from '@nthstock/utils';
import { strings } from '../strings';

export type MarketStatusView = {
  tone: 'open' | 'preOpen' | 'closed' | 'holiday';
  /** Short label shown in the pill: "Market open", "Pre-open", "Market closed", "Holiday: …". */
  label: string;
  /** Detail: "closes 3:30 pm IST" or "opens Mon 9:15 am IST". */
  detail: string;
};

const weekday = new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, weekday: 'short' });

/** "9:15 am" (drops the leading zero formatIstTime keeps). */
function time(date: Date): string {
  return formatIstTime(date).replace(/^0/, '').toLowerCase();
}

/** "today 9:15 am", "tomorrow 9:15 am" or "Mon 9:15 am", all in IST. */
export function describeNextOpen(clock: Clock): string {
  const now = clock.now();
  const next = nextSessionOpen(clock);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (istDateKey(next) === istDateKey(now)) return `today ${time(next)}`;
  if (istDateKey(next) === istDateKey(tomorrow)) return `tomorrow ${time(next)}`;
  return `${weekday.format(next)} ${time(next)}`;
}

/** Text for the header pill (T-029). Always text, never colour alone. */
export function marketStatusView(clock: Clock): MarketStatusView {
  const status = getMarketStatus(clock);
  if (status.state === 'open') return { tone: 'open', label: strings.open, detail: strings.closes };
  const opens = strings.opens(describeNextOpen(clock));
  if (status.state !== 'closed') return { tone: 'preOpen', label: strings.preOpen, detail: opens };
  if (status.reason === 'holiday') {
    return { tone: 'holiday', label: strings.holiday(status.holidayName ?? ''), detail: opens };
  }
  return { tone: 'closed', label: strings.closed, detail: opens };
}

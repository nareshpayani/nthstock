/**
 * Store UTC, display IST (CLAUDE.md §6). India has no daylight saving, so IST is always UTC+05:30;
 * everything here is independent of the machine's own time zone.
 */

export const IST_TIME_ZONE = 'Asia/Kolkata';
export const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** The source of "now". Inject it so tests and the market simulator control time. */
export type Clock = {
  now(): Date;
};

export const systemClock: Clock = { now: () => new Date() };

/** A clock stuck at one instant, for tests and demos. */
export function fixedClock(at: Date | string | number): Clock {
  const instant = new Date(at);
  if (Number.isNaN(instant.getTime())) throw new RangeError(`Invalid date: ${String(at)}`);
  return { now: () => new Date(instant) };
}

const timeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});
const dateFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "09:15 am" in IST. */
export function formatIstTime(date: Date): string {
  return timeFormat.format(date);
}

/** "25 Sept 2026" in IST (month abbreviation as Chrome's en-IN locale prints it). */
export function formatIstDate(date: Date): string {
  return dateFormat.format(date);
}

export type IstParts = {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** Minutes since IST midnight. */
  minuteOfDay: number;
};

/** Calendar fields of an instant as seen in IST. */
export function toIstParts(date: Date): IstParts {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** "2026-09-25": the IST calendar date, handy as a map key. */
export function istDateKey(date: Date): string {
  const { year, month, day } = toIstParts(date);
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The UTC instant of a given IST wall-clock time. */
export function fromIst(year: number, month: number, day: number, minuteOfDay: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, minuteOfDay - IST_OFFSET_MINUTES));
}

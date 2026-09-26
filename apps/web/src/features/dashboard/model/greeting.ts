import { toIstParts } from '@nthstock/utils';
import { strings } from '../strings';

/** Greeting by IST hour: morning until 12, afternoon until 17, evening after. */
export function greetingFor(now: Date): string {
  const hour = Math.floor(toIstParts(now).minuteOfDay / 60);
  if (hour < 12) return strings.greeting.morning;
  if (hour < 17) return strings.greeting.afternoon;
  return strings.greeting.evening;
}

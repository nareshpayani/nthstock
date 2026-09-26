import { toIstParts } from '@nthstock/utils';
import { strings } from '../strings';

/** Greeting by IST hour: morning until 12, afternoon until 17, evening after. */
export function greetingFor(now: Date): string {
  const hour = Math.floor(toIstParts(now).minuteOfDay / 60);
  if (hour < 12) return strings.greeting.morning;
  if (hour < 17) return strings.greeting.afternoon;
  return strings.greeting.evening;
}

/** The first word of a profile name, or null when there is no usable name. */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** "Good morning, Asha" for a signed-in user with a name, else just the greeting. */
export function heroGreeting(now: Date, name: string | null | undefined): string {
  const greeting = greetingFor(now);
  const first = firstName(name);
  return first ? strings.greeting.withName(greeting, first) : greeting;
}

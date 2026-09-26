const BROWSERS: readonly [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

const first = (ua: string, table: readonly [RegExp, string][]) =>
  table.find(([pattern]) => pattern.test(ua))?.[1];

/** A short human label for the sessions screen, e.g. `Chrome on macOS`. Never echoes the raw UA. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const browser = first(ua, BROWSERS) ?? 'Unknown browser';
  const system = first(ua, SYSTEMS);
  return system ? `${browser} on ${system}` : browser;
}

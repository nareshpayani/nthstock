// The device and viewport matrix of SPEC-CR-1 §6.3 (CR-17): every common screen class the mobile
// Trade from Charts flow must hold on, from a 320 px phone to a desktop. The layout matrix spec and
// the design captures (docs/design/) both read it. `engine` is where the row runs in CI: WebKit rows
// fall back to Chromium when WebKit is not installed (E2E_WEBKIT unset).

export type ViewportClass = 'phone' | 'landscape' | 'tablet' | 'desktop';

export type MatrixViewport = {
  /** File-name label, e.g. `phone-390x844`. */
  name: string;
  width: number;
  height: number;
  kind: ViewportClass;
  engine: 'chromium' | 'webkit';
  /** Devices this row stands for. */
  examples: string;
};

const row = (
  kind: ViewportClass,
  width: number,
  height: number,
  engine: MatrixViewport['engine'],
  examples: string,
): MatrixViewport => ({
  name: `${kind}-${String(width)}x${String(height)}`,
  width,
  height,
  kind,
  engine,
  examples,
});

export const VIEWPORT_MATRIX: readonly MatrixViewport[] = [
  row('phone', 320, 640, 'chromium', 'iPhone SE (1st gen), small Android'),
  row('phone', 344, 882, 'chromium', 'Galaxy Z Fold cover screen'),
  row('phone', 360, 740, 'chromium', 'Galaxy A and M series'),
  row('phone', 375, 667, 'webkit', 'iPhone SE (2nd, 3rd gen)'),
  row('phone', 390, 844, 'webkit', 'iPhone 12 to 14, iPhone 15 and 16'),
  row('phone', 393, 852, 'webkit', 'iPhone 15 Pro, iPhone 16'),
  row('phone', 393, 873, 'chromium', 'Pixel 7 to 9'),
  row('phone', 402, 874, 'webkit', 'iPhone 16 Pro, iPhone 17'),
  row('phone', 412, 915, 'chromium', 'Galaxy S Ultra, Pixel Pro'),
  row('phone', 430, 932, 'webkit', 'iPhone Pro Max and Plus'),
  row('phone', 440, 956, 'webkit', 'iPhone 16 Pro Max, iPhone 17 Pro Max'),
  row('landscape', 844, 390, 'webkit', 'Any phone turned sideways'),
  row('tablet', 673, 841, 'chromium', 'Galaxy Z Fold inner screen'),
  row('tablet', 820, 1180, 'webkit', 'iPad Air, Android tablets'),
  row('tablet', 1180, 820, 'webkit', 'iPad Air sideways'),
  row('desktop', 1440, 900, 'chromium', 'Chrome desktop'),
];

/** Rows that are touch devices (everything but the desktop row). */
export const isTouchViewport = (viewport: MatrixViewport): boolean => viewport.kind !== 'desktop';

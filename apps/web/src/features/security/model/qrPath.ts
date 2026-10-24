/** A QR code's module grid: `size` × `size`, `dark(row, col)` true for a dark module. */
export type QrModules = { size: number; dark: (row: number, col: number) => boolean };

/** Modules of light border around the code, as the QR standard asks, so scanners lock on. */
export const QR_QUIET_ZONE = 4;

/**
 * One SVG path for every dark module (a unit square each), offset by the quiet zone. One path
 * keeps a 41 × 41 code to a single DOM node.
 */
export function qrPath({ size, dark }: QrModules): string {
  const parts: string[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (dark(row, col)) {
        parts.push(`M${String(col + QR_QUIET_ZONE)} ${String(row + QR_QUIET_ZONE)}h1v1h-1z`);
      }
    }
  }
  return parts.join('');
}

import { strings } from '../strings';

/** The .txt the user downloads: a header, then one code per line. */
export function recoveryCodesText(codes: readonly string[], mobileMasked: string): string {
  return `${strings.codes.fileHeader(mobileMasked)}\n${codes.join('\n')}\n`;
}

/** Saves the codes as a .txt through a temporary object URL (no network, nothing stored). */
export function downloadRecoveryCodes(codes: readonly string[], mobileMasked: string): void {
  const blob = new Blob([recoveryCodesText(codes, mobileMasked)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = strings.codes.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

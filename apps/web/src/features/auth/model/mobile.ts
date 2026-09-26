/**
 * The 10-digit national number from whatever was typed or pasted: digits only, without a leading
 * +91, 91 or 0. Validation stays with the contracts `Mobile` schema.
 */
export function normalizeMobile(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** 9876543210 → "98765 43210", the way Indian numbers are usually read out. */
export function formatMobile(mobile: string): string {
  return mobile.length === 10 ? `${mobile.slice(0, 5)} ${mobile.slice(5)}` : mobile;
}

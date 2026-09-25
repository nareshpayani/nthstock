/**
 * Money is always integer paise (CLAUDE.md §6). These helpers format paise for display and parse
 * user input back to paise without ever doing arithmetic on floating-point rupees.
 */

const PAISE_PER_RUPEE = 100;
const PAISE_PER_LAKH = 100_000 * PAISE_PER_RUPEE;
const PAISE_PER_CRORE = 10_000_000 * PAISE_PER_RUPEE;

const rupeeGrouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

function assertPaise(paise: number): void {
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(`Expected an integer number of paise, got ${String(paise)}`);
  }
}

/** Formats paise as rupees with Indian grouping: 10000050 → "₹1,00,000.50". */
export function formatInr(paise: number): string {
  assertPaise(paise);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / PAISE_PER_RUPEE);
  const rest = abs % PAISE_PER_RUPEE;
  return `${sign}₹${rupeeGrouping.format(rupees)}.${String(rest).padStart(2, '0')}`;
}

/**
 * Short form for large amounts: lakh (L) and crore (Cr) with up to two decimals.
 * Amounts under ₹1 lakh fall back to formatInr. 1200000000 paise → "₹1.2 Cr".
 */
export function formatInrCompact(paise: number): string {
  assertPaise(paise);
  const abs = Math.abs(paise);
  const unit =
    abs >= PAISE_PER_CRORE
      ? { size: PAISE_PER_CRORE, suffix: 'Cr' }
      : abs >= PAISE_PER_LAKH
        ? { size: PAISE_PER_LAKH, suffix: 'L' }
        : undefined;
  if (!unit) return formatInr(paise);

  // Hundredths of a unit, rounded half up, still in integers.
  const hundredths = Math.round((abs * 100) / unit.size);
  const whole = Math.trunc(hundredths / 100);
  const fraction = String(hundredths % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  const sign = paise < 0 ? '-' : '';
  return `${sign}₹${rupeeGrouping.format(whole)}${fraction ? `.${fraction}` : ''} ${unit.suffix}`;
}

const RUPEE_INPUT = /^(-)?(\d{1,3}(?:,\d{2,3})*|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parses what a person typed ("1,234.5", "₹ 99", "-12.05") into paise.
 * Returns null for anything that is not a rupee amount with at most two decimals ("12.345").
 */
export function parseRupeesToPaise(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/^₹\s*/, '')
    .replace(/^(-)\s*₹\s*/, '$1');
  const match = RUPEE_INPUT.exec(cleaned);
  if (!match) return null;
  const [, minus, rupeePart = '', decimals = ''] = match;
  const rupees = Number(rupeePart.replaceAll(',', ''));
  const paise = rupees * PAISE_PER_RUPEE + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) return null;
  return minus && paise !== 0 ? -paise : paise;
}

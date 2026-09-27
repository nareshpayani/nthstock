import { formatInr, formatIstDate, formatIstTimeSeconds } from '@nthstock/utils';
import { strings } from '../strings';

/** A ledger time in IST with its date: "28 Sept 2026, 10:00:04 am" (stored UTC, shown IST). */
export function ledgerTimeLabel(iso: string): string {
  const at = new Date(iso);
  return `${formatIstDate(at)}, ${formatIstTimeSeconds(at)}`;
}

/** A signed ledger amount: "+₹1,500.00", "-₹1,500.00", "₹0.00"; spoken as a credit or debit. */
export function signedAmount(paise: number): { text: string; spoken: string } {
  if (paise > 0) {
    return { text: `+${formatInr(paise)}`, spoken: `${strings.ledger.credit} ${formatInr(paise)}` };
  }
  if (paise < 0) {
    return { text: formatInr(paise), spoken: `${strings.ledger.debit} ${formatInr(-paise)}` };
  }
  return { text: formatInr(0), spoken: formatInr(0) };
}

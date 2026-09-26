import type { Session } from '@nthstock/contracts';
import { safeStorage } from '@/shared/lib/safeStorage';

/**
 * Whether this browser is trusted for PIN login. The trusted-device token itself is an httpOnly
 * cookie the page cannot read, so the app keeps this hint next to it: only the display name and
 * the masked mobile (never the number, PIN or a token). A server that no longer trusts the device
 * answers PIN login with 401, and the hint is dropped.
 */
export type TrustedDeviceHint = { name: string | null; mobileMasked: string };

const KEY = 'nthstock.auth.trustedDevice';

export function readTrustedDevice(): TrustedDeviceHint | null {
  try {
    const raw = safeStorage.get(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    const { name, mobileMasked } = parsed as Record<string, unknown>;
    if (typeof mobileMasked !== 'string' || !/^\*{6}\d{4}$/.test(mobileMasked)) return null;
    return { name: typeof name === 'string' ? name : null, mobileMasked };
  } catch {
    return null;
  }
}

/** Remembers the device after a PIN is set or used, forgets it when the session says untrusted. */
export function rememberTrustedDevice(session: Session): void {
  if (!session.device.trusted) return;
  const hint: TrustedDeviceHint = {
    name: session.user.name,
    mobileMasked: session.user.mobileMasked,
  };
  safeStorage.set(KEY, JSON.stringify(hint));
}

export function forgetTrustedDevice(): void {
  safeStorage.remove(KEY);
}

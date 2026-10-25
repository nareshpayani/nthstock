import { formatIstDate, formatIstTime } from '@nthstock/utils';
import type { Notifier } from './notifier.js';
import type { NewNotification } from './schema.js';

/** The account events that raise a `SECURITY` notification (NSTOCK-0382, spec §6.1). */
export type SecurityEvent =
  | { type: 'NEW_DEVICE'; deviceLabel: string; sessionId: string }
  | { type: 'TOTP_ENABLED' }
  | { type: 'TOTP_DISABLED' }
  | { type: 'SESSIONS_ENDED'; count: number };

const TITLES: Record<SecurityEvent['type'], string> = {
  NEW_DEVICE: 'New sign-in to your account',
  TOTP_ENABLED: 'Two-factor authentication turned on',
  TOTP_DISABLED: 'Two-factor authentication turned off',
  SESSIONS_ENDED: 'Other devices logged out',
};

/**
 * The notification for one security event. The body names the device type (from the user agent,
 * e.g. "Chrome on macOS") and the IST time only: never a mobile number, a name or an IP address.
 */
export function securityNotification(
  userId: string,
  event: SecurityEvent,
  at: Date,
): NewNotification {
  const when = `${formatIstDate(at)}, ${formatIstTime(at)} IST`;
  const lead =
    event.type === 'NEW_DEVICE'
      ? event.deviceLabel
      : event.type === 'SESSIONS_ENDED'
        ? `${String(event.count)} ${event.count === 1 ? 'session' : 'sessions'} ended`
        : null;
  const body = [lead, when, 'Not you? Change your PIN.'].filter(Boolean).join(' · ');
  return {
    userId,
    kind: 'SECURITY',
    refId: event.type === 'NEW_DEVICE' ? event.sessionId : null,
    title: TITLES[event.type],
    body: body.slice(0, 200),
    symbol: null,
    exchange: null,
  };
}

/** What an auth service needs to raise one: the notifier and where a failure is reported. */
export type SecurityNotices = {
  notifier: Pick<Notifier, 'raise'>;
  /** A failed notification never fails the action that raised it; it is logged here. */
  onError: (error: unknown) => void;
};

/** Raises the event's notification without waiting for it or letting it fail the caller. */
export function raiseSecurityNotice(
  notices: SecurityNotices | undefined,
  userId: string,
  event: SecurityEvent,
  at: Date,
): void {
  if (!notices) return;
  notices.notifier.raise([securityNotification(userId, event, at)]).catch(notices.onError);
}

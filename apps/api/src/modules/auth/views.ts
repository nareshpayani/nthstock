import type { Device, Session } from '@nthstock/contracts';
import { toUser } from '../users/index.js';
import type { DeviceRecord } from './repo.js';
import type { AuthContext, IssuedSession } from './sessionService.js';

export function toDevice(record: DeviceRecord, currentDeviceId: string): Device {
  return {
    id: record.id,
    label: record.label,
    trusted: record.trusted,
    current: record.id === currentDeviceId,
    createdAt: record.createdAt.toISOString(),
    lastSeenAt: record.lastSeenAt.toISOString(),
  };
}

/** The Session body for a newly issued or rotated session. */
export function toSession(issued: IssuedSession): Session {
  return {
    user: toUser(issued.user),
    device: toDevice(issued.device, issued.device.id),
    accessToken: issued.access.token,
    accessTokenExpiresAt: issued.access.expiresAt.toISOString(),
    csrfToken: issued.session.csrfToken,
  };
}

/** The Session body for the session behind the presented access token. */
export function toCurrentSession(context: AuthContext): Session {
  return {
    user: toUser(context.user),
    device: toDevice(context.device, context.device.id),
    accessToken: context.token,
    accessTokenExpiresAt: new Date(context.claims.exp * 1000).toISOString(),
    csrfToken: context.session.csrfToken,
  };
}

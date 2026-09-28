import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { REFRESH_TOKEN_TTL_SEC, type AccessTokenClaims } from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { AuditRepo } from '../audit/repo.js';
import type { AuditActor } from '../audit/schema.js';
import type { UserRecord, UsersRepo } from '../users/repo.js';
import { signAccessToken, verifyAccessToken, type SignedAccessToken } from './accessToken.js';
import { deviceLabel } from './deviceLabel.js';
import type { AuthRepo, DeviceRecord, SessionRecord } from './repo.js';

export type SessionServiceDeps = {
  clock: Clock;
  repo: AuthRepo;
  users: UsersRepo;
  /** HS256 key for access tokens (see `resolveJwtSecret`). */
  secret: Uint8Array;
  /** LOGIN_SUCCESS, LOGOUT, REFRESH_REUSE_DETECTED and SESSION_REVOKED go here (T-188). */
  audit: AuditRepo;
  /** Id generator for sessions and devices; default `<prefix>_<uuid>`. */
  newId?: (prefix: 'ses' | 'dev') => string;
};

/** A freshly issued (or rotated) session with everything the route needs to answer. */
export type IssuedSession = {
  session: SessionRecord;
  user: UserRecord;
  device: DeviceRecord;
  access: SignedAccessToken;
  /** The new refresh token. Only ever sent in the httpOnly cookie. */
  refreshToken: string;
};

/** Who a valid access token belongs to. */
export type AuthContext = {
  claims: AccessTokenClaims;
  /** The access token as presented. */
  token: string;
  /** How it was presented; only cookie-borne tokens need the CSRF check. */
  via: 'bearer' | 'cookie';
  session: SessionRecord;
  user: UserRecord;
  device: DeviceRecord;
};

/** How the user proved who they are; recorded on LOGIN_SUCCESS. */
export type LoginMethod = 'OTP' | 'PIN';

export type StartSessionInput = {
  user: UserRecord;
  method: LoginMethod;
  userAgent: string | undefined;
  /** A device already known for this user (trusted-device cookie); a new one is created otherwise. */
  deviceId?: string | null;
};

export type SessionService = {
  start(input: StartSessionInput): Promise<IssuedSession>;
  /** Rotates the refresh token. Reuse of an old token revokes the whole family (401). */
  refresh(refreshToken: string): Promise<IssuedSession>;
  /** Resolves the session behind an access token, or null when it is invalid, expired or revoked. */
  authenticate(accessToken: string, via: AuthContext['via']): Promise<AuthContext | null>;
  /** Ends the caller's own session (LOGOUT). */
  logout(context: AuthContext): Promise<void>;
  /** Revokes a session on someone's behalf (SESSION_REVOKED); a no-op for an unknown session. */
  revoke(sessionId: string, actor: AuditActor): Promise<void>;
};

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const newRefreshToken = () => randomBytes(32).toString('base64url');

export const sessionEnded = () =>
  new ApiHttpError(401, 'UNAUTHORIZED', 'Your session has ended. Please log in again.');

/**
 * Sessions (T-080): a 15-min access JWT plus a rotating refresh token. The session id is the
 * refresh token family: presenting an already-rotated refresh token revokes the family, so a
 * stolen token stops working for both the thief and the owner.
 *
 * Audited (T-188, spec backend-core §8), one entry each and never a token in the detail: a new
 * session is LOGIN_SUCCESS, logout is LOGOUT, a reused refresh token is REFRESH_REUSE_DETECTED
 * (written by the system: it caught it) and revoking another session is SESSION_REVOKED.
 */
export function createSessionService({
  clock,
  repo,
  users,
  secret,
  audit,
  newId = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '')}`,
}: SessionServiceDeps): SessionService {
  async function issue(session: SessionRecord, user: UserRecord, device: DeviceRecord) {
    const now = clock.now();
    const refreshToken = newRefreshToken();
    await repo.putRefreshToken(hashToken(refreshToken), {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      usedAt: null,
    });
    const access = await signAccessToken(secret, { userId: user.id, sessionId: session.id }, now);
    return { session, user, device, access, refreshToken };
  }

  async function deviceFor(input: StartSessionInput, now: Date): Promise<DeviceRecord> {
    if (input.deviceId) {
      const known = await repo.getDevice(input.deviceId);
      if (known && known.userId === input.user.id) {
        return (await repo.updateDevice(known.id, { lastSeenAt: now })) ?? known;
      }
    }
    const device: DeviceRecord = {
      id: newId('dev'),
      userId: input.user.id,
      label: deviceLabel(input.userAgent),
      trusted: false,
      createdAt: now,
      lastSeenAt: now,
    };
    await repo.createDevice(device);
    return device;
  }

  return {
    async start(input) {
      const now = clock.now();
      const device = await deviceFor(input, now);
      const session: SessionRecord = {
        id: newId('ses'),
        userId: input.user.id,
        deviceId: device.id,
        csrfToken: randomBytes(32).toString('base64url'),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SEC * 1000),
        revokedAt: null,
        revokedReason: null,
      };
      await repo.createSession(session);
      const issued = await issue(session, input.user, device);
      await audit.append({
        actor: { type: 'user', userId: input.user.id },
        userId: input.user.id,
        action: 'LOGIN_SUCCESS',
        orderId: null,
        outcome: 'OK',
        detail: { method: input.method, sessionId: session.id, deviceId: device.id },
      });
      return issued;
    },

    async refresh(refreshToken) {
      const now = clock.now();
      const token = await repo.useRefreshToken(hashToken(refreshToken), now);
      if (!token) throw sessionEnded();
      if (token.usedAt) {
        await repo.revokeSession(token.sessionId, now, 'REUSE_DETECTED');
        const family = await repo.getSession(token.sessionId);
        await audit.append({
          actor: { type: 'system' },
          userId: family?.userId ?? null,
          action: 'REFRESH_REUSE_DETECTED',
          orderId: null,
          outcome: 'REFUSED',
          detail: { sessionId: token.sessionId },
        });
        throw sessionEnded();
      }
      const session = await repo.getSession(token.sessionId);
      if (!session || session.revokedAt || session.expiresAt <= now || token.expiresAt <= now) {
        throw sessionEnded();
      }
      const [user, device] = await Promise.all([
        users.findById(session.userId),
        repo.getDevice(session.deviceId),
      ]);
      if (!user || !device) throw sessionEnded();
      return issue(session, user, device);
    },

    async authenticate(accessToken, via) {
      const now = clock.now();
      const claims = await verifyAccessToken(secret, accessToken, now);
      if (!claims) return null;
      const session = await repo.getSession(claims.sid);
      if (!session || session.revokedAt || session.userId !== claims.sub) return null;
      const [user, device] = await Promise.all([
        users.findById(session.userId),
        repo.getDevice(session.deviceId),
      ]);
      if (!user || !device) return null;
      return { claims, token: accessToken, via, session, user, device };
    },

    async logout(context) {
      await repo.revokeSession(context.session.id, clock.now(), 'LOGOUT');
      await audit.append({
        actor: { type: 'user', userId: context.user.id },
        userId: context.user.id,
        action: 'LOGOUT',
        orderId: null,
        outcome: 'OK',
        detail: { sessionId: context.session.id },
      });
    },

    async revoke(sessionId, actor) {
      const session = await repo.getSession(sessionId);
      if (!session) return;
      await repo.revokeSession(sessionId, clock.now(), 'USER_REVOKED');
      await audit.append({
        actor,
        userId: session.userId,
        action: 'SESSION_REVOKED',
        orderId: null,
        outcome: 'OK',
        detail: { sessionId },
      });
    },
  };
}

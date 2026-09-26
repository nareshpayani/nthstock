import { randomUUID } from 'node:crypto';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  ACCESS_TOKEN_TTL_SEC,
  AccessTokenClaims,
} from '@nthstock/contracts';
import { SignJWT, jwtVerify } from 'jose';

const ALG = 'HS256';

export type SignedAccessToken = { token: string; expiresAt: Date };

/** Signs a 15-min access JWT for a session, stamped by the injected clock. */
export async function signAccessToken(
  secret: Uint8Array,
  { userId, sessionId }: { userId: string; sessionId: string },
  now: Date,
): Promise<SignedAccessToken> {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ACCESS_TOKEN_TTL_SEC;
  const token = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ACCESS_TOKEN_ISSUER)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    // A unique id, so two tokens issued in the same second differ (and can be told apart later).
    .setJti(randomUUID())
    .sign(secret);
  return { token, expiresAt: new Date(exp * 1000) };
}

/**
 * Verifies signature, algorithm, issuer, audience and expiry against `now`. Resolves to the claims,
 * or null for any invalid or expired token (the caller answers 401 without saying why).
 */
export async function verifyAccessToken(
  secret: Uint8Array,
  token: string,
  now: Date,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALG],
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
      currentDate: now,
      clockTolerance: 0,
    });
    const claims = AccessTokenClaims.safeParse(payload);
    return claims.success ? claims.data : null;
  } catch {
    return null;
  }
}

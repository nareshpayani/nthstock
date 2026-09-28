import {
  ACCESS_TOKEN_TTL_SEC,
  AUTH_COOKIES,
  SessionRevokedEvent,
  routes,
  sessionRevokedChannel,
  sessionRevokedKey,
} from '@nthstock/contracts';
import { expect, it } from 'vitest';
import type { App } from '../../app.js';
import { cookieHeader, csrfHeader, loginWithOtp } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import { describeWithPostgresAndRedis } from '../../test/postgresRedisApp.js';
import { createPgAuthRepo } from './pgRepo.js';
import { createMemoryOtpStore } from './repo.js';

// The session-revocation cache and event (T-194): two apps/api instances sharing Redis and
// Postgres, as behind a load balancer.

const secret = new Uint8Array(32).fill(5);
const MOBILE = '9876543210';

/** The session id (`sid` claim) an access token carries. */
const sessionIdOf = (access: string): string =>
  (
    JSON.parse(Buffer.from(access.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      sid: string;
    }
  ).sid;

const sessionGet = (app: App, access: string) =>
  app.inject({
    method: 'GET',
    url: routes.sessionGet.path,
    headers: { cookie: cookieHeader({ [AUTH_COOKIES.access]: access }) },
  });

describeWithPostgresAndRedis(
  'session revocation across instances (integration, T-194)',
  ({ app, redis, prefix, database }) => {
    it('refuses a session revoked on one instance on the other within 1 s', async () => {
      const clock = manualClock();
      const a = app({ deps: { clock, jwtSecret: secret } });
      const b = app({ deps: { clock, jwtSecret: secret } });
      const { access, csrf, session } = await loginWithOtp(a, MOBILE);
      expect((await sessionGet(b, access)).statusCode).toBe(200);

      const subscriber = redis().duplicate();
      const events: unknown[] = [];
      await subscriber.subscribe(sessionRevokedChannel(prefix()));
      subscriber.on('message', (_channel, message: string) => events.push(JSON.parse(message)));
      try {
        const loggedOut = await a.inject({
          method: 'POST',
          url: routes.logout.path,
          headers: { ...csrfHeader(csrf), cookie: cookieHeader({ [AUTH_COOKIES.access]: access }) },
        });
        expect(loggedOut.statusCode).toBe(200);
        const revokedAt = Date.now();

        expect((await sessionGet(b, access)).statusCode).toBe(401);
        expect(Date.now() - revokedAt).toBeLessThan(1_000);

        // Marked for as long as an access token lives, and announced once with no PII.
        const ttl = await redis().ttl(sessionRevokedKey(sessionIdOf(access), prefix()));
        expect(ttl).toBeGreaterThan(ACCESS_TOKEN_TTL_SEC - 5);
        expect(ttl).toBeLessThanOrEqual(ACCESS_TOKEN_TTL_SEC);
        await expect.poll(() => events.length, { timeout: 1_000 }).toBe(1);
        expect(SessionRevokedEvent.parse(events[0])).toEqual({
          v: 1,
          sessionId: sessionIdOf(access),
          userId: session.user.id,
        });
        expect(JSON.stringify(events)).not.toContain(MOBILE);
      } finally {
        await subscriber.quit();
      }
    });

    it('checks the cache before Postgres: a marked session is refused without a row read', async () => {
      const clock = manualClock();
      const a = app({ deps: { clock, jwtSecret: secret } });
      let sessionReads = 0;
      const counted = createPgAuthRepo({
        database: database(),
        clock,
        otp: createMemoryOtpStore(),
      });
      const b = app({
        deps: {
          clock,
          jwtSecret: secret,
          repos: {
            auth: {
              ...counted,
              getSession: (id) => {
                sessionReads += 1;
                return counted.getSession(id);
              },
            },
          },
        },
      });
      const { access } = await loginWithOtp(a, MOBILE);
      expect((await sessionGet(b, access)).statusCode).toBe(200);
      expect(sessionReads).toBe(1);

      // As if the row read went to a replica that has not seen the revocation yet.
      await redis().set(sessionRevokedKey(sessionIdOf(access), prefix()), '1', 'EX', 60);

      expect((await sessionGet(b, access)).statusCode).toBe(401);
      expect(sessionReads).toBe(1);
    });

    it('marks the family on refresh-token reuse, so every instance refuses it', async () => {
      const clock = manualClock();
      const a = app({ deps: { clock, jwtSecret: secret } });
      const b = app({ deps: { clock, jwtSecret: secret } });
      const { access, refresh, session } = await loginWithOtp(a, MOBILE);
      const refreshWith = (instance: App) =>
        instance.inject({
          method: 'POST',
          url: routes.sessionRefresh.path,
          headers: {
            ...csrfHeader(session.csrfToken),
            cookie: cookieHeader({ [AUTH_COOKIES.refresh]: refresh }),
          },
        });

      expect((await refreshWith(a)).statusCode).toBe(200);
      expect((await refreshWith(b)).statusCode).toBe(401);

      expect(await redis().exists(sessionRevokedKey(sessionIdOf(access), prefix()))).toBe(1);
      expect((await sessionGet(a, access)).statusCode).toBe(401);
    });
  },
);
